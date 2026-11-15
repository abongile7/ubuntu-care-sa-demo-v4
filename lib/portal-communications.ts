import { createHash, timingSafeEqual } from "node:crypto";
import type {
  Prisma,
  PortalDocument,
  PortalDocumentVersion,
  PortalFile,
  PortalThread,
  User
} from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { type Actor, CareError, audit, text, optionalText, errorResponse } from "@/lib/care-access";
import {
  requirePortalEncounter,
  portalContacts,
  canAccessDocument,
  requireDocumentAccess
} from "@/lib/portal-access";

type Database = Prisma.TransactionClient;
type FileDigest = Pick<PortalFile, "originalName" | "mimeType" | "size" | "sha256"> & {
  bytes?: Uint8Array;
};
type HashVersion = Pick<PortalDocumentVersion, "documentId" | "version" | "title" | "body"> & {
  files?: readonly FileDigest[];
};
const clinicalRoles = ["admin", "doctor", "nurse"];
const claimRoles = [...clinicalRoles, "billing"];
const fileSelection = {
  id: true,
  originalName: true,
  mimeType: true,
  size: true,
  sha256: true
} as const;
const userSelection = {
  id: true,
  name: true,
  role: true,
  organization: true,
  email: true,
  unit: true
} as const;
const versionInclude = {
  files: { select: fileSelection },
  signatures: { orderBy: { createdAt: "asc" as const } }
} as const;
const secureHeaders = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff"
};

export function portalJson(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: secureHeaders });
}

export function portalErrorResponse(error: unknown) {
  const response = errorResponse(error);
  for (const [key, value] of Object.entries(secureHeaders)) response.headers.set(key, value);
  return response;
}

/** Stable UTF-8 content fingerprint. Dates and database IDs of attachments are intentionally excluded. */
export function documentHash(version: HashVersion): string {
  const files = (version.files ?? [])
    .map(({ originalName, mimeType, size, sha256 }) => ({ originalName, mimeType, size, sha256 }))
    .sort(
      (a, b) =>
        a.sha256.localeCompare(b.sha256) ||
        a.originalName.localeCompare(b.originalName) ||
        a.mimeType.localeCompare(b.mimeType) ||
        a.size - b.size
    );
  return createHash("sha256")
    .update(
      JSON.stringify({
        documentId: version.documentId,
        version: version.version,
        title: version.title,
        body: version.body,
        files
      }),
      "utf8"
    )
    .digest("hex");
}

export function verifyVersionHash(version: HashVersion & { contentHash: string }): boolean {
  if (!/^[a-f0-9]{64}$/.test(version.contentHash)) return false;
  if (
    (version.files ?? []).some(
      (file) =>
        file.bytes &&
        (file.bytes.byteLength !== file.size ||
          createHash("sha256").update(file.bytes).digest("hex") !== file.sha256)
    )
  )
    return false;
  return timingSafeEqual(
    Buffer.from(documentHash(version), "hex"),
    Buffer.from(version.contentHash, "hex")
  );
}

function requireIntegrity(version: HashVersion & { contentHash: string }) {
  if (!verifyVersionHash(version))
    throw new CareError(
      409,
      "Document integrity check failed. Ask hospital staff to review this version."
    );
}

function booleanValue(value: unknown, label: string, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new CareError(400, `${label} must be true or false.`);
  return value;
}

function concurrentMutation(error: unknown): never {
  if (error && typeof error === "object" && "code" in error && error.code === "P2002")
    throw new CareError(
      409,
      "This record changed or was already acknowledged. Refresh and try again."
    );
  throw error;
}

function identifiers(value: unknown, label: string, max = 20): string[] {
  if (
    !Array.isArray(value) ||
    value.length > max ||
    value.some((id) => typeof id !== "string" || !id.trim() || id.length > 150)
  ) {
    throw new CareError(400, `${label} must be a list of at most ${max} identifiers.`);
  }
  return [...new Set(value as string[])];
}

function person(user: Pick<User, "id" | "name" | "role" | "organization">) {
  return { id: user.id, name: user.name, role: user.role, organization: user.organization };
}

async function recordRequestFor(
  encounterId: string,
  requestId: string | null | undefined,
  tx: Database
) {
  if (!requestId) throw new CareError(400, "Select a records request.");
  const request = await tx.portalRecordRequest.findFirst({
    where: {
      id: requestId,
      encounterId,
      status: { notIn: ["CANCELLED", "EXPIRED"] },
      expiresAt: { gt: new Date() }
    }
  });
  if (!request || !request.consentRecordedAt)
    throw new CareError(404, "Active records request not found.");
  return request;
}

async function validateThreadScope(
  actor: Actor,
  thread: Pick<PortalThread, "encounterId" | "type" | "claimId" | "recordRequestId">,
  participants: Actor[],
  tx: Database
) {
  const encounter = await requirePortalEncounter(actor, thread.encounterId, tx);
  const patientId = encounter.patient.userId;
  switch (thread.type) {
    case "CARE":
      if (
        participants.some(
          (user) =>
            !clinicalRoles.includes(user.role) &&
            !(user.role === "patient" && user.id === patientId)
        )
      )
        throw new CareError(
          403,
          "Care conversations are limited to this patient and hospital care staff."
        );
      break;
    case "CLAIM": {
      const claim = thread.claimId
        ? await tx.careClaim.findFirst({
            where: {
              id: thread.claimId,
              encounterId: encounter.id,
              sharedWithInsurer: true,
              submittedAt: { not: null },
              status: { not: "DRAFT" }
            }
          })
        : null;
      if (!claim || !encounter.patient.popiaConsent || !encounter.patient.consentDataSharing)
        throw new CareError(404, "A submitted claim with current sharing consent is required.");
      if (
        participants.some(
          (user) =>
            !claimRoles.includes(user.role) &&
            !(user.role === "patient" && user.id === patientId) &&
            !(user.role === "insurer" && user.organization === claim.scheme)
        )
      )
        throw new CareError(
          403,
          "Claim participants must belong to the patient, hospital or this claim's scheme."
        );
      break;
    }
    case "HANDOVER":
      if (
        participants.some(
          (user) =>
            !clinicalRoles.includes(user.role) &&
            !(user.role === "paramedic" && user.id === encounter.crewUserId)
        )
      )
        throw new CareError(
          403,
          "Handover conversations are limited to the assigned crew and hospital care staff."
        );
      break;
    case "RECORD_REQUEST": {
      const request = await recordRequestFor(encounter.id, thread.recordRequestId, tx);
      if (
        participants.some(
          (user) =>
            !(
              clinicalRoles.includes(user.role) &&
              [request.createdById, request.assignedStaffId].includes(user.id)
            ) &&
            !(user.role === "patient" && user.id === patientId) &&
            !(user.role === "referring_doctor" && user.id === request.providerUserId)
        )
      )
        throw new CareError(
          403,
          "This conversation is limited to the records request's patient, provider and assigned hospital staff."
        );
      break;
    }
    default:
      throw new CareError(400, "Select a supported conversation type.");
  }
  return encounter;
}

async function requireThread(actor: Actor, threadId: string, tx: Database = prisma) {
  const thread = await tx.portalThread.findFirst({
    where: { id: threadId, members: { some: { userId: actor.id } } },
    include: { members: true }
  });
  if (!thread) throw new CareError(404, "Conversation not found.");
  const users = await tx.user.findMany({
    where: { id: { in: thread.members.map((member) => member.userId) } },
    select: userSelection
  });
  if (users.length !== thread.members.length) throw new CareError(404, "Conversation not found.");
  await validateThreadScope(actor, thread, users, tx);
  return { thread, users };
}

async function attachmentsFor(
  actor: Actor,
  ids: string[],
  encounterId: string,
  tx: Database,
  requirePublished = true
) {
  const files = await tx.portalFile.findMany({
    where: { id: { in: ids } },
    include: { version: { include: { document: true } } }
  });
  if (files.length !== ids.length) throw new CareError(404, "Attachment not found.");
  for (const file of files) {
    const encounter = await requirePortalEncounter(actor, encounterId, tx);
    if (
      file.version.document.encounterId !== encounterId ||
      (requirePublished && file.version.status !== "PUBLISHED")
    )
      throw new CareError(404, "Published attachment not found.");
    await requireDocumentAccess(actor, encounter, file.version.document, tx);
  }
  return files.map(({ id, originalName, mimeType, size, sha256 }) => ({
    id,
    originalName,
    mimeType,
    size,
    sha256
  }));
}

function storedAttachmentIds(value: string): string[] {
  try {
    return identifiers(JSON.parse(value), "Attachments");
  } catch {
    return [];
  }
}

export async function getPortalMessages(actor: Actor, query: URLSearchParams) {
  const threadId = query.get("threadId");
  if (threadId) {
    const { thread, users } = await requireThread(actor, text(threadId, "Conversation", 150));
    const messages = await prisma.portalMessage.findMany({
      where: { threadId: thread.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 500
    });
    const visibleMessages = [];
    for (const message of messages) {
      const attachments = [];
      for (const id of storedAttachmentIds(message.attachmentIdsJson)) {
        try {
          attachments.push(...(await attachmentsFor(actor, [id], thread.encounterId, prisma)));
        } catch (error) {
          if (!(error instanceof CareError)) throw error;
        }
      }
      const { attachmentIdsJson: _attachmentIds, ...fields } = message;
      visibleMessages.push({ ...fields, attachments });
    }
    return {
      ok: true,
      thread: { ...thread, members: users.map(person), messages: visibleMessages }
    };
  }
  const encounter = await requirePortalEncounter(
    actor,
    text(query.get("encounterId"), "Encounter", 150)
  );
  const candidates = await prisma.portalThread.findMany({
    where: { encounterId: encounter.id, members: { some: { userId: actor.id } } },
    include: { members: true, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { updatedAt: "desc" },
    take: 100
  });
  const threads = [];
  for (const candidate of candidates) {
    try {
      const { users } = await requireThread(actor, candidate.id);
      const member = candidate.members.find((item) => item.userId === actor.id)!;
      const unread = await prisma.portalMessage.count({
        where: {
          threadId: candidate.id,
          authorId: { not: actor.id },
          ...(member.lastReadAt ? { createdAt: { gt: member.lastReadAt } } : {})
        }
      });
      const { messages, ...fields } = candidate;
      const lastMessage = messages[0]
        ? {
            id: messages[0].id,
            body: messages[0].body,
            authorId: messages[0].authorId,
            authorName: messages[0].authorName,
            authorRole: messages[0].authorRole,
            createdAt: messages[0].createdAt
          }
        : null;
      threads.push({ ...fields, members: users.map(person), lastMessage, unread });
    } catch (error) {
      if (!(error instanceof CareError) || ![403, 404].includes(error.status)) throw error;
    }
  }
  return { ok: true, threads };
}

export async function mutatePortalMessages(actor: Actor, input: Record<string, unknown>) {
  return prisma
    .$transaction(async (tx) => {
      switch (input.action) {
        case "createThread": {
          const encounter = await requirePortalEncounter(
            actor,
            text(input.encounterId, "Encounter", 150),
            tx
          );
          const type = text(input.type, "Conversation type", 40);
          const subject = text(input.subject, "Subject", 160);
          const memberIds = [
            ...new Set([actor.id, ...identifiers(input.memberIds, "Participants")])
          ];
          if (memberIds.length < 2)
            throw new CareError(400, "Choose at least one other participant.");
          const contacts = await portalContacts(actor, encounter, tx);
          if (
            memberIds.some(
              (id) => id !== actor.id && !contacts.some((contact) => contact.id === id)
            )
          )
            throw new CareError(403, "Choose participants from the available encounter contacts.");
          const users = await tx.user.findMany({
            where: { id: { in: memberIds } },
            select: userSelection
          });
          if (users.length !== memberIds.length) throw new CareError(404, "Participant not found.");
          const claimId = optionalText(input.claimId, "Claim", 150) || null;
          const recordRequestId =
            optionalText(input.recordRequestId, "Records request", 150) || null;
          if ((type !== "CLAIM" && claimId) || (type !== "RECORD_REQUEST" && recordRequestId))
            throw new CareError(400, "The linked record must match the conversation type.");
          await validateThreadScope(
            actor,
            { encounterId: encounter.id, type, claimId, recordRequestId },
            users,
            tx
          );
          const thread = await tx.portalThread.create({
            data: {
              encounterId: encounter.id,
              type,
              subject,
              claimId,
              recordRequestId,
              createdById: actor.id,
              members: { create: memberIds.map((userId) => ({ userId })) }
            }
          });
          await audit(
            tx,
            actor,
            encounter.id,
            "PORTAL_THREAD_CREATED",
            `thread=${thread.id};type=${type};members=${memberIds.length}`
          );
          return { ok: true, threadId: thread.id };
        }
        case "send": {
          const { thread, users } = await requireThread(
            actor,
            text(input.threadId, "Conversation", 150),
            tx
          );
          const body = text(input.body, "Message", 10000);
          const attachmentIds =
            input.attachmentIds === undefined
              ? []
              : identifiers(input.attachmentIds, "Attachments", 10);
          for (const user of users)
            await attachmentsFor(user, attachmentIds, thread.encounterId, tx);
          const emailCopy = booleanValue(input.emailCopy, "Email copy");
          const message = await tx.portalMessage.create({
            data: {
              threadId: thread.id,
              authorId: actor.id,
              authorName: actor.name,
              authorRole: actor.role,
              body,
              attachmentIdsJson: JSON.stringify(attachmentIds)
            }
          });
          await tx.portalThread.update({
            where: { id: thread.id },
            data: { updatedAt: new Date() }
          });
          await tx.portalThreadMember.update({
            where: { threadId_userId: { threadId: thread.id, userId: actor.id } },
            data: { lastReadAt: message.createdAt }
          });
          for (const user of users.filter((user) => user.id !== actor.id)) {
            await tx.portalNotification.create({
              data: {
                encounterId: thread.encounterId,
                userId: user.id,
                title: "New secure message",
                body: "A participant sent a message. Sign in to the portal to read it.",
                kind: "MESSAGE",
                link: "/connect",
                dedupeKey: `message:${message.id}:${user.id}`
              }
            });
            if (emailCopy)
              await tx.portalOutbox.create({
                data: {
                  encounterId: thread.encounterId,
                  recipientUserId: user.id,
                  recipientEmail: user.email,
                  subject: "UbuntuCare demo: new secure message",
                  body: "A new secure message is available. Sign in to the UbuntuCare portal to review it. This notification is simulated; no external email was sent.",
                  category: "MESSAGE_NOTIFICATION",
                  createdById: actor.id,
                  dedupeKey: `message-email:${message.id}:${user.id}`
                }
              });
          }
          await audit(
            tx,
            actor,
            thread.encounterId,
            "PORTAL_MESSAGE_SENT",
            `thread=${thread.id};message=${message.id};attachments=${attachmentIds.length};simulatedEmail=${emailCopy}`
          );
          return { ok: true, messageId: message.id };
        }
        case "markRead": {
          const { thread } = await requireThread(
            actor,
            text(input.threadId, "Conversation", 150),
            tx
          );
          await tx.portalThreadMember.update({
            where: { threadId_userId: { threadId: thread.id, userId: actor.id } },
            data: { lastReadAt: new Date() }
          });
          await audit(tx, actor, thread.encounterId, "PORTAL_THREAD_READ", `thread=${thread.id}`);
          return { ok: true };
        }
        default:
          throw new CareError(400, "Select a supported conversation action.");
      }
    })
    .catch(concurrentMutation);
}

async function requireDocument(actor: Actor, documentId: string, tx: Database = prisma) {
  const document = await tx.portalDocument.findUnique({ where: { id: documentId } });
  if (!document) throw new CareError(404, "Document not found.");
  const encounter = await requirePortalEncounter(actor, document.encounterId, tx);
  await requireDocumentAccess(actor, encounter, document, tx);
  return { document, encounter };
}

function maySeeDraft(actor: Actor, document: PortalDocument) {
  return (
    clinicalRoles.includes(actor.role) ||
    document.createdById === actor.id ||
    (actor.role === "billing" && document.visibility === "CLAIM")
  );
}

function requireDocumentAuthor(actor: Actor, document: PortalDocument) {
  if (clinicalRoles.includes(actor.role)) return;
  if (
    document.createdById !== actor.id ||
    !["patient", "referring_doctor", "billing"].includes(actor.role)
  )
    throw new CareError(403, "Only the author or hospital care staff can prepare this document.");
  if (actor.role === "billing" && document.visibility !== "CLAIM")
    throw new CareError(403, "Billing staff may prepare claim documents only.");
  if (actor.role === "patient" && !["PATIENT_UPLOAD", "RECORD_REQUEST"].includes(document.kind))
    throw new CareError(403, "Patients may prepare their own uploaded records only.");
  if (
    actor.role === "referring_doctor" &&
    (document.visibility !== "RECORD_REQUEST" || document.kind !== "RECORD_REQUEST")
  )
    throw new CareError(403, "Referring doctors may prepare requested records only.");
}

export async function getPortalDocuments(actor: Actor, encounterId: string) {
  const encounter = await requirePortalEncounter(actor, encounterId);
  const candidates = await prisma.portalDocument.findMany({
    where: { encounterId },
    include: { versions: { include: versionInclude, orderBy: { version: "desc" } } },
    orderBy: { updatedAt: "desc" },
    take: 200
  });
  const documents = [];
  for (const document of candidates) {
    if (!(await canAccessDocument(actor, encounter, document))) continue;
    const versions = maySeeDraft(actor, document)
      ? document.versions
      : document.versions.filter((version) => version.status === "PUBLISHED").slice(0, 1);
    if (!versions.length) continue;
    documents.push({ ...document, versions, latestVersion: versions[0] });
  }
  return { ok: true, documents };
}

export async function mutatePortalDocuments(actor: Actor, input: Record<string, unknown>) {
  return prisma
    .$transaction(async (tx) => {
      if (input.action === "create") {
        const encounter = await requirePortalEncounter(
          actor,
          text(input.encounterId, "Encounter", 150),
          tx
        );
        const title = text(input.title, "Title", 200);
        const body = text(input.body, "Document text", 100000);
        const kind = text(input.kind, "Document kind", 80);
        const visibility = text(input.visibility, "Visibility", 40);
        if (!["INTERNAL", "PATIENT", "CLAIM", "HANDOVER", "RECORD_REQUEST"].includes(visibility))
          throw new CareError(400, "Choose a supported document visibility.");
        const claimId = optionalText(input.claimId, "Claim", 150) || null;
        if (visibility === "CLAIM") {
          if (
            !claimId ||
            !(await tx.careClaim.findFirst({
              where: { id: claimId, encounterId: encounter.id },
              select: { id: true }
            }))
          )
            throw new CareError(400, "Select a claim belonging to this encounter.");
        } else if (claimId)
          throw new CareError(400, "A claim can be linked to claim documents only.");
        const recordRequestId = optionalText(input.recordRequestId, "Records request", 150) || null;
        if (visibility === "RECORD_REQUEST")
          await recordRequestFor(encounter.id, recordRequestId, tx);
        else if (recordRequestId)
          throw new CareError(400, "Records request documents require request visibility.");
        if (!clinicalRoles.includes(actor.role)) {
          if (actor.role === "patient") {
            if (
              !(
                (kind === "PATIENT_UPLOAD" && visibility === "PATIENT") ||
                (kind === "RECORD_REQUEST" && visibility === "RECORD_REQUEST")
              )
            )
              throw new CareError(
                403,
                "Patients can upload their own records for patient or records-request use."
              );
          } else if (actor.role === "referring_doctor") {
            const request = await recordRequestFor(encounter.id, recordRequestId, tx);
            if (
              request.providerUserId !== actor.id ||
              kind !== "RECORD_REQUEST" ||
              visibility !== "RECORD_REQUEST"
            )
              throw new CareError(403, "Upload records to your assigned records request.");
          } else if (actor.role !== "billing" || visibility !== "CLAIM")
            throw new CareError(403, "Your role cannot create this document.");
        }
        const document = await tx.portalDocument.create({
          data: {
            encounterId: encounter.id,
            title,
            kind,
            visibility,
            claimId,
            recordRequestId,
            createdById: actor.id
          }
        });
        await requireDocumentAccess(actor, encounter, document, tx);
        const fields = { documentId: document.id, version: 1, title, body };
        const version = await tx.portalDocumentVersion.create({
          data: {
            ...fields,
            contentHash: documentHash(fields),
            requiresPatientSignature: booleanValue(
              input.requiresPatientSignature,
              "Acknowledgement required"
            ),
            createdById: actor.id
          }
        });
        await audit(
          tx,
          actor,
          encounter.id,
          "PORTAL_DOCUMENT_CREATED",
          `document=${document.id};version=${version.id};visibility=${visibility}`
        );
        return { ok: true, documentId: document.id, versionId: version.id };
      }
      if (input.action === "newVersion") {
        const { document, encounter } = await requireDocument(
          actor,
          text(input.documentId, "Document", 150),
          tx
        );
        requireDocumentAuthor(actor, document);
        const latest = await tx.portalDocumentVersion.findFirst({
          where: { documentId: document.id },
          orderBy: { version: "desc" }
        });
        if (!latest) throw new CareError(404, "Document version not found.");
        const fields = {
          documentId: document.id,
          version: latest.version + 1,
          title: input.title === undefined ? latest.title : text(input.title, "Title", 200),
          body: text(input.body, "Document text", 100000)
        };
        const version = await tx.portalDocumentVersion.create({
          data: {
            ...fields,
            contentHash: documentHash(fields),
            requiresPatientSignature: booleanValue(
              input.requiresPatientSignature,
              "Acknowledgement required",
              latest.requiresPatientSignature
            ),
            createdById: actor.id
          }
        });
        await tx.portalDocument.update({
          where: { id: document.id },
          data: { updatedAt: new Date() }
        });
        await audit(
          tx,
          actor,
          encounter.id,
          "PORTAL_DOCUMENT_VERSION_CREATED",
          `document=${document.id};version=${version.id}`
        );
        return { ok: true, documentId: document.id, versionId: version.id };
      }
      if (input.action === "publish" || input.action === "sign") {
        const version = await tx.portalDocumentVersion.findUnique({
          where: { id: text(input.versionId, "Version", 150) },
          include: { files: true, document: true, signatures: true }
        });
        if (!version) throw new CareError(404, "Document version not found.");
        const { encounter } = await requireDocument(actor, version.documentId, tx);
        requireIntegrity(version);
        if (input.action === "publish") {
          requireDocumentAuthor(actor, version.document);
          if (version.status !== "DRAFT")
            throw new CareError(
              409,
              "Published versions are immutable. Prepare a new version to make changes."
            );
          const changed = await tx.portalDocumentVersion.updateMany({
            where: { id: version.id, status: "DRAFT", contentHash: version.contentHash },
            data: { status: "PUBLISHED", publishedAt: new Date() }
          });
          if (!changed.count)
            throw new CareError(409, "This version changed. Refresh and try again.");
          await tx.portalDocument.update({
            where: { id: version.documentId },
            data: { updatedAt: new Date() }
          });
          await audit(
            tx,
            actor,
            encounter.id,
            "PORTAL_DOCUMENT_PUBLISHED",
            `document=${version.documentId};version=${version.id};hash=${version.contentHash}`
          );
          return { ok: true, versionId: version.id };
        }
        if (version.status !== "PUBLISHED")
          throw new CareError(409, "Only published document versions can be acknowledged.");
        if (
          !clinicalRoles.includes(actor.role) &&
          !(actor.role === "patient" && encounter.patient.userId === actor.id)
        )
          throw new CareError(
            403,
            "Only this patient or hospital care staff can acknowledge this document."
          );
        if (input.acknowledged !== true)
          throw new CareError(
            400,
            "Confirm that you have read and acknowledge this exact version."
          );
        if (
          text(input.typedName, "Typed name", 160).normalize("NFC").toLocaleLowerCase("en-ZA") !==
          actor.name.trim().normalize("NFC").toLocaleLowerCase("en-ZA")
        )
          throw new CareError(400, "Type your signed-in name exactly as displayed.");
        if (version.signatures.some((signature) => signature.signerId === actor.id))
          throw new CareError(409, "You have already acknowledged this version.");
        const statement =
          "I have read and acknowledge this exact document version. This is a demo typed acknowledgement, not an advanced electronic signature or a substitute for document-specific legal or clinical consent.";
        const signature = await tx.portalSignature.create({
          data: {
            versionId: version.id,
            signerId: actor.id,
            signerName: actor.name,
            signerRole: actor.role,
            type: "TYPED_ACKNOWLEDGEMENT",
            contentHash: version.contentHash,
            statement
          }
        });
        await audit(
          tx,
          actor,
          encounter.id,
          "PORTAL_DOCUMENT_ACKNOWLEDGED",
          `version=${version.id};signature=${signature.id};hash=${version.contentHash}`
        );
        return { ok: true, signature };
      }
      throw new CareError(400, "Select a supported document action.");
    })
    .catch(concurrentMutation);
}

const maximumFileBytes = 5 * 1024 * 1024;

function sniffFile(bytes: Uint8Array, suppliedMime: string, name: string) {
  const buffer = Buffer.from(bytes);
  let mimeType: string;
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") mimeType = "application/pdf";
  else if (
    buffer.length >= 24 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    buffer.subarray(12, 16).toString("ascii") === "IHDR"
  )
    mimeType = "image/png";
  else if (
    buffer.length >= 4 &&
    buffer[0] === 255 &&
    buffer[1] === 216 &&
    buffer[2] === 255 &&
    buffer[buffer.length - 2] === 255 &&
    buffer[buffer.length - 1] === 217
  )
    mimeType = "image/jpeg";
  else {
    let decoded: string;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new CareError(400, "Only PDF, PNG, JPEG or UTF-8 plain text files are accepted.");
    }
    if (
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(decoded) ||
      /<\s*(?:!doctype\s+html|html|head|body|script|svg|iframe|object|embed)\b/i.test(decoded) ||
      /^\s*(?:#!|MZ|\x7fELF|<\/?[a-z][^>]*>)/i.test(decoded)
    )
      throw new CareError(400, "HTML, SVG, executable and binary text files are not accepted.");
    mimeType = "text/plain";
  }
  const supplied = suppliedMime.toLowerCase().split(";")[0].trim();
  if (supplied && supplied !== mimeType)
    throw new CareError(400, "The file content does not match its declared MIME type.");
  const extension = name.toLowerCase().match(/\.([^.]+)$/)?.[1];
  const allowedExtensions: Record<string, readonly string[]> = {
    "application/pdf": ["pdf"],
    "image/png": ["png"],
    "image/jpeg": ["jpg", "jpeg"],
    "text/plain": ["txt", "text", "csv", "log"]
  };
  if (!extension || !allowedExtensions[mimeType].includes(extension))
    throw new CareError(400, "The filename extension must match the accepted file type.");
  return mimeType;
}

export async function uploadPortalFile(actor: Actor, request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;"))
    throw new CareError(400, "Send the file as multipart form data.");
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumFileBytes + 100000)
    throw new CareError(413, "Files must be 5 MiB or smaller.");
  // Bound the entire multipart body before parsing, including requests without Content-Length.
  if (!request.body) throw new CareError(400, "Choose a file to upload.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    received += chunk.value.byteLength;
    if (received > maximumFileBytes + 100000) {
      await reader.cancel();
      throw new CareError(413, "Files must be 5 MiB or smaller.");
    }
    chunks.push(chunk.value);
  }
  let form: FormData;
  try {
    form = await new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: Buffer.concat(chunks)
    }).formData();
  } catch {
    throw new CareError(400, "Send a valid multipart upload.");
  }
  const versionId = text(form.get("versionId"), "Version", 150);
  const file = form.get("file");
  if (!(file instanceof File)) throw new CareError(400, "Choose a file to upload.");
  if (!file.size || file.size > maximumFileBytes)
    throw new CareError(file.size ? 413 : 400, "Choose a nonempty file of 5 MiB or smaller.");
  const originalName = file.name
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)!
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180);
  if (!originalName) throw new CareError(400, "Choose a file with a valid filename.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = sniffFile(bytes, file.type, originalName);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return prisma.$transaction(async (tx) => {
    const version = await tx.portalDocumentVersion.findUnique({
      where: { id: versionId },
      include: { document: true, files: true }
    });
    if (!version) throw new CareError(404, "Document version not found.");
    const { encounter } = await requireDocument(actor, version.documentId, tx);
    requireDocumentAuthor(actor, version.document);
    if (version.status !== "DRAFT")
      throw new CareError(
        409,
        "Published attachments are immutable. Prepare a new document version."
      );
    requireIntegrity(version);
    if (version.files.length >= 10)
      throw new CareError(400, "A document version may contain at most ten files.");
    const contentHash = documentHash({
      ...version,
      files: [...version.files, { originalName, mimeType, size: bytes.byteLength, sha256 }]
    });
    const changed = await tx.portalDocumentVersion.updateMany({
      where: { id: version.id, status: "DRAFT", contentHash: version.contentHash },
      data: { contentHash }
    });
    if (!changed.count) throw new CareError(409, "This draft changed. Refresh and try again.");
    const created = await tx.portalFile.create({
      data: {
        versionId,
        originalName,
        mimeType,
        size: bytes.byteLength,
        sha256,
        bytes,
        uploadedById: actor.id
      },
      select: fileSelection
    });
    await tx.portalDocument.update({
      where: { id: version.documentId },
      data: { updatedAt: new Date() }
    });
    await audit(
      tx,
      actor,
      encounter.id,
      "PORTAL_FILE_UPLOADED",
      `version=${versionId};file=${created.id};size=${bytes.byteLength};sha256=${sha256}`
    );
    return { ok: true, file: created, contentHash };
  });
}

export async function downloadPortalFile(actor: Actor, fileId: string) {
  const file = await prisma.portalFile.findUnique({
    where: { id: fileId },
    include: { version: { include: { document: true, files: true } } }
  });
  if (!file) throw new CareError(404, "File not found.");
  const { document } = await requireDocument(actor, file.version.documentId);
  if (file.version.status !== "PUBLISHED" && !maySeeDraft(actor, document))
    throw new CareError(404, "File not found.");
  requireIntegrity(file.version);
  const asciiName = file.originalName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return new Response(Buffer.from(file.bytes), {
    headers: {
      ...secureHeaders,
      "Content-Type": file.mimeType === "text/plain" ? "text/plain; charset=utf-8" : file.mimeType,
      "Content-Length": String(file.size),
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.originalName).replaceAll("'", "%27")}`,
      "Content-Security-Policy": "default-src 'none'; sandbox"
    }
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function printPortalDocument(actor: Actor, versionId: string) {
  const version = await prisma.portalDocumentVersion.findUnique({
    where: { id: versionId },
    include: { document: true, files: true, signatures: { orderBy: { createdAt: "asc" } } }
  });
  if (!version) throw new CareError(404, "Document version not found.");
  const { document } = await requireDocument(actor, version.documentId);
  if (version.status !== "PUBLISHED" && !maySeeDraft(actor, document))
    throw new CareError(404, "Document version not found.");
  requireIntegrity(version);
  if (version.signatures.some((signature) => signature.contentHash !== version.contentHash))
    throw new CareError(
      409,
      "Acknowledgement integrity check failed. Ask hospital staff to review this version."
    );
  const acknowledgements = version.signatures
    .map(
      (signature) =>
        `<li><strong>${escapeHtml(signature.signerName)}</strong> (${escapeHtml(signature.signerRole)}), ${escapeHtml(signature.createdAt.toISOString())}<p>${escapeHtml(signature.statement)}</p><small>Bound content hash: ${escapeHtml(signature.contentHash)}</small></li>`
    )
    .join("");
  const attachments = version.files
    .map(
      (file) =>
        `<li>${escapeHtml(file.originalName)} · ${escapeHtml(file.mimeType)} · ${file.size} bytes<br><small>SHA-256: ${escapeHtml(file.sha256)}</small></li>`
    )
    .join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(version.title)}</title><style>body{font-family:system-ui,sans-serif;max-width:850px;margin:2rem auto;padding:0 1rem;color:#172c34}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.6}small{overflow-wrap:anywhere}li{margin:1rem 0}.notice{border:1px solid #999;padding:1rem}@media print{body{margin:0;max-width:none}.notice{break-inside:avoid}}</style></head><body><p class="notice">Fictional hospital demo. Use your browser's Print → Save as PDF. Typed acknowledgements are demo evidence and are not advanced electronic signatures or a promise of legal or clinical consent validity.</p><h1>${escapeHtml(version.title)}</h1><p>Version ${version.version} · ${escapeHtml(version.status)} · ${escapeHtml(version.publishedAt?.toISOString() ?? "Draft")}</p><p><small>Document: ${escapeHtml(version.documentId)}<br>Version ID: ${escapeHtml(version.id)}<br>SHA-256 content hash: ${escapeHtml(version.contentHash)}</small></p><pre>${escapeHtml(version.body)}</pre><h2>Attachments</h2><ul>${attachments || "<li>No attachments.</li>"}</ul><h2>Typed acknowledgements</h2><ul>${acknowledgements || "<li>No acknowledgements recorded.</li>"}</ul></body></html>`;
  return new Response(html, {
    headers: {
      ...secureHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer"
    }
  });
}
