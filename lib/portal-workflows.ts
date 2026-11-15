import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  type Actor,
  CareError,
  audit,
  ref,
  requireRole,
  text,
  optionalText,
  versionNumber
} from "@/lib/care-access";
import {
  isHospital,
  portalEncounterWhere,
  portalContacts,
  requirePortalEncounter,
  type PortalEncounter
} from "@/lib/portal-access";
import {
  concernCategories,
  portalDepartments,
  portalOrganizations,
  taskStatuses
} from "@/lib/portal-constants";
import { verifyVersionHash } from "@/lib/portal-communications";

type Db = Prisma.TransactionClient;
const isPatient = (actor: Actor, encounter: PortalEncounter) =>
  actor.role === "patient" && encounter.patient.userId === actor.id;
const recordsStaff: readonly Role[] = ["admin", "doctor", "nurse"];

async function notify(
  tx: Db,
  encounterId: string,
  userId: string,
  title: string,
  body: string,
  kind: string,
  dedupeKey: string
) {
  return tx.portalNotification.upsert({
    where: { dedupeKey },
    update: {},
    create: {
      encounterId,
      userId,
      title,
      body,
      kind,
      dedupeKey,
      link: `/connect?encounterId=${encounterId}`
    }
  });
}

function isoDate(value: unknown, label: string) {
  const raw = text(value, label, 40);
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(raw))
    throw new CareError(400, `${label} needs an explicit timezone offset.`);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new CareError(400, `Enter a valid ${label}.`);
  return parsed;
}

async function safeStaff(
  tx: Db,
  value: unknown,
  label: string,
  allowed: readonly Role[] = ["admin", "doctor", "nurse", "billing", "paramedic"]
) {
  const id = text(value, label, 100);
  const user = await tx.user.findFirst({
    where: { id, role: { in: [...allowed] } },
    select: { id: true, name: true, role: true }
  });
  if (!user) throw new CareError(400, `Select a valid ${label.toLowerCase()}.`);
  return user;
}

function assistantResponse(actor: Actor, encounter: PortalEncounter, message = "") {
  const recommendations: { title: string; detail: string; tab: string }[] = [];
  if (actor.role === "referring_doctor") {
    recommendations.push({
      title: "Fulfil the consented records request",
      detail:
        "Read the requested scope, upload the relevant document version and send it for hospital review.",
      tab: "worklists"
    });
  } else if (actor.role === "insurer") {
    recommendations.push({
      title: "Review the submitted claim",
      detail:
        "Use the claim packet and claim-linked messages/documents for your medical-aid scheme.",
      tab: "messages"
    });
  } else {
    recommendations.push({
      title: "Use a patient-specific conversation",
      detail:
        "Select verified participants and keep clinical, handover and claim conversations separate.",
      tab: "messages"
    });
    if (actor.role === "patient" || isHospital(actor)) {
      recommendations.push({
        title: "Complete document acknowledgements",
        detail:
          "Read the issued version and check its title before acknowledging. Acknowledgements in this demo are not accredited advanced signatures.",
        tab: "documents"
      });
      recommendations.push({
        title: "Plan follow-up",
        detail:
          "Request or confirm an appointment, read the clinician's instructions and check reminders.",
        tab: "appointments"
      });
    }
  }
  if (actor.role === "billing")
    recommendations.push({
      title: "Prepare the medical-aid query",
      detail:
        "Link the thread and supporting documents to the exact claim. External notification email is simulated.",
      tab: "messages"
    });
  const lower = message.toLowerCase();
  let answer = `This is a rules-based workflow assistant for the selected encounter (${encounter.reference.slice(0, 16)}…). It can explain portal steps and point you to the right worklist. Every record change needs an authorised person to confirm it.`;
  if (/(symptom|pain|dose|diagnos|treat|bleed|breath|suicid|medical advice|emergen)/.test(lower)) {
    answer =
      "For clinical advice, submit a concern to your treating team or use the hospital's clinical contact route. Urgent concerns require immediate human attention. For an emergency in South Africa, call 112 from a cellphone or 10177 for ambulance assistance. This assistant does not diagnose, prescribe or decide treatment.";
  } else if (/(appoint|calendar|remind|video|call)/.test(lower)) {
    answer =
      actor.role === "patient" || isHospital(actor)
        ? "Open Appointments to request or confirm a time with the assigned clinician. Calendar exports use explicit times; reminder processing creates portal notifications and simulated email copies. Video requires a confirmed video appointment, patient consent and the assigned clinician. The demo uses direct local browser video; cross-network reliability needs a validated deployment."
        : "Appointment and video access belongs to the patient and their hospital care team. Use your scoped conversation to request coordination with the hospital.";
  } else if (/(sign|document|upload|form|paper)/.test(lower)) {
    answer =
      "Open Documents, choose the correct visibility and upload only the intended file. Publish the exact version before acknowledgement. An issued version is immutable; corrections need a new version. Demo typed acknowledgements preserve user, time and content hash and must not be presented as legally validated signing for every form.";
  } else if (/(previous|prior|record|referr)/.test(lower)) {
    answer =
      "Use Concerns & records to request a specific scope from the previous practice with an explicit consent record. The previous practice sees only its assigned request and request documents. Upload and fulfilment are followed by hospital doctor review; the portal does not retrieve other doctors' records automatically.";
  } else if (/(claim|medical aid|authoris|authoriz|email)/.test(lower)) {
    answer =
      "Use a CLAIM conversation with the matching scheme and exact submitted claim. Only consented, claim-linked supporting documents can be shared with that reviewer. Eligibility, authorisation, claim review and payment are separate simulated services; no medical aid or email provider is contacted by this demo.";
  } else if (/(concern|complain|question|help)/.test(lower)) {
    answer =
      "Submit a patient concern with its category and urgency. A named hospital inbox receives a notification, and staff can acknowledge, respond, resolve and reopen it. This demo is not a monitored emergency service; urgent care must use the hospital's clinical or emergency contact route.";
  }
  return {
    mode: "rules",
    summary: "Workflow guidance with human confirmation",
    recommendations,
    limitations: "No clinical diagnosis, autonomous decisions or model-provider connection.",
    answer,
    suggestions: recommendations,
    requiresHumanReview: true
  };
}

export async function portalSnapshot(actor: Actor, requestedId?: string | null) {
  const cases = await prisma.careEncounter.findMany({
    where: portalEncounterWhere(actor),
    select: {
      id: true,
      reference: true,
      status: true,
      patientId: true,
      patient: { select: { id: true, fullName: true, facilityFileNumber: true } }
    },
    orderBy: { openedAt: "desc" },
    take: 100
  });
  const selected = requestedId ? cases.find((item) => item.id === requestedId) : cases[0];
  if (requestedId && !selected) throw new CareError(404, "Encounter not found.");
  const departments = actor.role === "billing" ? ["Billing"] : [...portalDepartments];
  const empty = {
    ok: true,
    session: actor,
    encounters: cases,
    activeEncounter: null,
    contacts: [],
    departments,
    organizations: portalOrganizations,
    externalProviders: [],
    claims: [],
    concerns: [],
    recordRequests: [],
    tasks: [],
    notifications: [],
    outbox: [],
    assistant: {
      mode: "rules",
      summary: "Select an authorised encounter",
      recommendations: [],
      limitations: "Workflow guidance only."
    }
  };
  if (!selected) return empty;
  const encounter = await requirePortalEncounter(actor, selected.id);
  const hospital = isHospital(actor);
  const own = isPatient(actor, encounter);
  const recordAccess = hospital || own || actor.role === "referring_doctor";
  const concernAccess = hospital || own || actor.role === "billing";
  const taskAccess = hospital || actor.role === "billing" || actor.role === "paramedic";
  const [contacts, concerns, requests, tasks, notifications, outbox, providers, claims] =
    await Promise.all([
      portalContacts(actor, encounter),
      concernAccess
        ? prisma.portalConcern.findMany({
            where: {
              encounterId: encounter.id,
              ...(actor.role === "billing" ? { category: "BILLING" } : {})
            },
            include: { updates: { orderBy: { createdAt: "asc" } } },
            orderBy: [{ urgency: "desc" }, { createdAt: "desc" }],
            take: 100
          })
        : [],
      recordAccess
        ? prisma.portalRecordRequest.findMany({
            where: {
              encounterId: encounter.id,
              ...(actor.role === "referring_doctor"
                ? {
                    providerUserId: actor.id,
                    status: { notIn: ["CANCELLED", "EXPIRED"] },
                    expiresAt: { gt: new Date() }
                  }
                : {})
            },
            orderBy: { createdAt: "desc" },
            take: 100
          })
        : [],
      taskAccess
        ? prisma.portalTask.findMany({
            where: {
              encounterId: encounter.id,
              ...(actor.role === "billing"
                ? { department: "Billing" }
                : actor.role === "paramedic"
                  ? { assignedUserId: actor.id }
                  : {})
            },
            orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
            take: 100
          })
        : [],
      prisma.portalNotification.findMany({
        where: { encounterId: encounter.id, userId: actor.id },
        orderBy: { createdAt: "desc" },
        take: 100
      }),
      prisma.portalOutbox.findMany({
        where: {
          encounterId: encounter.id,
          ...(actor.role === "admin"
            ? {}
            : { OR: [{ recipientUserId: actor.id }, { createdById: actor.id }] })
        },
        orderBy: { createdAt: "desc" },
        take: 100
      }),
      hospital || own
        ? prisma.user.findMany({
            where: { role: "referring_doctor" },
            select: { id: true, name: true, organization: true, email: true }
          })
        : [],
      actor.role === "paramedic" || actor.role === "referring_doctor"
        ? []
        : prisma.careClaim.findMany({
            where: {
              encounterId: encounter.id,
              ...(actor.role === "insurer"
                ? { scheme: actor.organization ?? "", sharedWithInsurer: true }
                : {})
            },
            select: { id: true, reference: true, scheme: true, status: true },
            orderBy: { createdAt: "desc" }
          })
    ]);
  const userIds = [
    ...new Set(
      [
        ...concerns.map((item) => item.assignedUserId),
        ...requests.flatMap((item) => [item.providerUserId, item.assignedStaffId]),
        ...tasks.map((item) => item.assignedUserId)
      ].filter((id): id is string => Boolean(id))
    )
  ];
  const names = new Map(
    (
      await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true }
      })
    ).map((user) => [user.id, user.name])
  );
  return {
    ...empty,
    activeEncounter: {
      ...selected,
      patient: {
        ...selected.patient,
        ...(hospital || own
          ? {
              userId: encounter.patient.userId,
              popiaConsent: encounter.patient.popiaConsent,
              consentDataSharing: encounter.patient.consentDataSharing,
              consentTreatment: encounter.patient.consentTreatment
            }
          : {})
      }
    },
    contacts,
    externalProviders: providers,
    claims,
    concerns: concerns.map((item) => ({
      ...item,
      assignedName: item.assignedUserId ? names.get(item.assignedUserId) : undefined
    })),
    recordRequests: requests.map((item) => ({
      ...item,
      providerDisplayName: item.providerUserId ? names.get(item.providerUserId) : item.providerName,
      assignedName: item.assignedStaffId ? names.get(item.assignedStaffId) : undefined
    })),
    tasks: tasks.map((item) => ({ ...item, assigneeName: names.get(item.assignedUserId) })),
    notifications,
    outbox: outbox.map((item) => ({
      id: item.id,
      subject: item.subject,
      category: item.category,
      status: item.status,
      createdAt: item.createdAt,
      deliveredAt: item.deliveredAt,
      ...(actor.role === "admin" || item.recipientUserId === actor.id
        ? { recipientEmail: item.recipientEmail }
        : {})
    })),
    assistant: assistantResponse(actor, encounter)
  };
}

async function concernAction(
  tx: Db,
  actor: Actor,
  encounter: PortalEncounter,
  action: string,
  body: Record<string, unknown>
) {
  const encounterId = encounter.id;
  if (action === "createConcern") {
    if (!isHospital(actor) && !isPatient(actor, encounter))
      throw new CareError(403, "Only the patient or hospital care team can submit a concern.");
    const category = text(body.category, "Concern category", 40);
    const urgency = text(body.urgency, "Urgency", 20);
    if (
      !concernCategories.some((item) => item === category) ||
      !["NORMAL", "URGENT"].includes(urgency)
    )
      throw new CareError(400, "Select a valid concern category and urgency.");
    const ownerRole: Role =
      category === "BILLING"
        ? "billing"
        : ["CARE_QUESTION", "MEDICATION", "DISCHARGE"].includes(category) || urgency === "URGENT"
          ? "nurse"
          : "admin";
    const owner = await tx.user.findFirst({ where: { role: ownerRole }, select: { id: true } });
    const concern = await tx.portalConcern.create({
      data: {
        encounterId,
        category,
        urgency,
        body: text(body.body, "Concern", 5000),
        createdById: actor.id,
        assignedUserId: owner?.id,
        updates: {
          create: {
            authorId: actor.id,
            authorName: actor.name,
            authorRole: actor.role,
            body: "Concern submitted for human review.",
            status: "OPEN"
          }
        }
      },
      include: { updates: true }
    });
    const reviewRoles: Role[] =
      category === "BILLING"
        ? ["admin", "billing"]
        : urgency === "URGENT" || ["CARE_QUESTION", "MEDICATION", "DISCHARGE"].includes(category)
          ? ["admin", "doctor", "nurse"]
          : ["admin"];
    const reviewers = await tx.user.findMany({
      where: { role: { in: reviewRoles } },
      select: { id: true }
    });
    const recipientIds = new Set(reviewers.map((user) => user.id));
    if (owner) recipientIds.add(owner.id);
    for (const userId of recipientIds)
      await notify(
        tx,
        encounterId,
        userId,
        urgency === "URGENT" ? "Urgent concern needs human review" : "New patient concern",
        "Open the assigned concern in the patient portal.",
        "CONCERN",
        `concern:${concern.id}:created:${userId}`
      );
    await audit(tx, actor, encounterId, "PORTAL_CONCERN_CREATED", `${category}; ${urgency}`);
    return { ok: true, concern };
  }
  const concern = await tx.portalConcern.findFirst({
    where: { id: text(body.concernId, "Concern", 100), encounterId }
  });
  if (!concern) throw new CareError(404, "Concern not found.");
  if (actor.role === "billing" && concern.category !== "BILLING")
    throw new CareError(403, "Billing can respond only to billing concerns.");
  const canStaff = isHospital(actor) || actor.role === "billing";
  if (!canStaff && !(action === "reopenConcern" && isPatient(actor, encounter)))
    throw new CareError(403, "Your role cannot update this concern.");
  const version = versionNumber(body.version);
  let status = concern.status;
  let assignedUserId = concern.assignedUserId;
  let response = optionalText(body.body, "Concern response", 5000);
  if (action === "assignConcern") {
    if (concern.status === "RESOLVED")
      throw new CareError(409, "Reopen a resolved concern before assignment.");
    const user = await safeStaff(
      tx,
      body.assignedUserId,
      "Assigned staff member",
      concern.category === "BILLING" ? ["admin", "billing"] : recordsStaff
    );
    assignedUserId = user.id;
    status = "ACKNOWLEDGED";
    response ||= "Your concern has been acknowledged and assigned to a staff member.";
  } else if (action === "respondConcern") {
    if (concern.status === "RESOLVED")
      throw new CareError(409, "Reopen this concern before adding a response.");
    response = text(body.body, "Patient-visible response", 5000);
    status = "ACKNOWLEDGED";
    assignedUserId ||= actor.id;
  } else if (action === "resolveConcern") {
    if (concern.status === "RESOLVED")
      throw new CareError(409, "This concern is already resolved.");
    response = text(body.body, "Resolution and patient instructions", 5000);
    status = "RESOLVED";
    assignedUserId ||= actor.id;
  } else if (action === "reopenConcern") {
    if (concern.status !== "RESOLVED")
      throw new CareError(409, "Only a resolved concern can be reopened.");
    response = text(body.body, "Reason for reopening", 5000);
    status = "OPEN";
  } else throw new CareError(400, "Unknown concern action.");
  const changed = await tx.portalConcern.updateMany({
    where: { id: concern.id, version },
    data: { status, assignedUserId, version: { increment: 1 } }
  });
  if (changed.count !== 1) throw new CareError(409, "The concern changed. Refresh and try again.");
  await tx.portalConcernUpdate.create({
    data: {
      concernId: concern.id,
      authorId: actor.id,
      authorName: actor.name,
      authorRole: actor.role,
      body: response,
      status
    }
  });
  const recipient = actor.role === "patient" ? assignedUserId : encounter.patient.userId;
  if (recipient)
    await notify(
      tx,
      encounterId,
      recipient,
      "Concern updated",
      "A concern response or status update is available in your portal.",
      "CONCERN",
      `concern:${concern.id}:${version + 1}:${recipient}`
    );
  await audit(tx, actor, encounterId, `PORTAL_CONCERN_${status}`);
  return {
    ok: true,
    concern: await tx.portalConcern.findUnique({
      where: { id: concern.id },
      include: { updates: { orderBy: { createdAt: "asc" } } }
    })
  };
}

async function recordAction(
  tx: Db,
  actor: Actor,
  encounter: PortalEncounter,
  action: string,
  body: Record<string, unknown>
) {
  const encounterId = encounter.id;
  if (action === "requestRecords") {
    if (!isHospital(actor) && !isPatient(actor, encounter))
      throw new CareError(403, "Your role cannot request previous records.");
    if (!encounter.patient.popiaConsent || body.consentConfirmed !== true)
      throw new CareError(
        409,
        "Confirm the patient's specific records-sharing permission and privacy acknowledgement."
      );
    const providerEmail = text(body.providerEmail, "Previous practice email", 200).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(providerEmail))
      throw new CareError(400, "Enter a valid previous practice email.");
    const providerUserId =
      optionalText(body.providerUserId, "Previous practice account", 100) || null;
    if (
      providerUserId &&
      !(await tx.user.findFirst({
        where: { id: providerUserId, role: "referring_doctor", email: providerEmail }
      }))
    )
      throw new CareError(400, "The selected previous practice account and email must match.");
    const assignedStaffId = body.assignedStaffId
      ? (await safeStaff(tx, body.assignedStaffId, "Records coordinator", recordsStaff)).id
      : (await tx.user.findFirst({ where: { role: "doctor" }, select: { id: true } }))?.id;
    const request = await tx.portalRecordRequest.create({
      data: {
        reference: ref("REC"),
        encounterId,
        providerName: text(body.providerName, "Previous practice name", 160),
        providerEmail,
        providerUserId,
        purpose: text(body.purpose, "Records-sharing purpose", 500),
        scope: text(body.scope, "Requested records scope", 2000),
        consentRecordedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
        createdById: actor.id,
        assignedStaffId
      }
    });
    if (assignedStaffId)
      await notify(
        tx,
        encounterId,
        assignedStaffId,
        "Previous records request needs review",
        "Review the patient's scope and consent before simulating a request to the previous practice.",
        "RECORDS",
        `records:${request.id}:created`
      );
    await audit(tx, actor, encounterId, "PORTAL_RECORDS_REQUESTED", request.reference);
    return { ok: true, recordRequest: request };
  }
  const request = await tx.portalRecordRequest.findFirst({
    where: {
      id: text(body.requestId, "Records request", 100),
      encounterId,
      ...(actor.role === "referring_doctor" ? { providerUserId: actor.id } : {})
    }
  });
  if (!request) throw new CareError(404, "Records request not found.");
  const version = versionNumber(body.version);
  const data: Prisma.PortalRecordRequestUpdateManyMutationInput = { version: { increment: 1 } };
  if (action === "cancelRecordRequest") {
    if (!isHospital(actor) && !isPatient(actor, encounter))
      throw new CareError(403, "Only the patient or hospital can revoke this request.");
    if (request.status === "CANCELLED")
      throw new CareError(409, "This records request is already cancelled.");
    data.status = "CANCELLED";
  } else {
    if (request.status === "CANCELLED" || request.expiresAt <= new Date())
      throw new CareError(409, "The records-sharing permission has expired or been revoked.");
    if (action === "simulateRecordRequest") {
      requireRole(actor, recordsStaff);
      if (request.status !== "REQUESTED")
        throw new CareError(409, "This request has already been sent or completed.");
      data.status = "SENT_SIMULATED";
    } else if (action === "fulfilRecordRequest") {
      if (!isHospital(actor) && actor.role !== "referring_doctor")
        throw new CareError(
          403,
          "Only the assigned previous practice or hospital can fulfil this request."
        );
      if (request.status !== "SENT_SIMULATED")
        throw new CareError(409, "A sent records request is required before fulfilment.");
      const document = await tx.portalDocumentVersion.findFirst({
        where: { id: text(body.versionId, "Published document version", 100) },
        include: { document: true, files: true }
      });
      if (
        !document ||
        document.document.encounterId !== encounterId ||
        document.document.recordRequestId !== request.id ||
        document.document.visibility !== "RECORD_REQUEST"
      )
        throw new CareError(400, "Use a document belonging to this exact records request.");
      if (document.status !== "PUBLISHED")
        throw new CareError(409, "Publish the previous records version before fulfilment.");
      if (!verifyVersionHash(document))
        throw new CareError(409, "Document integrity verification failed.");
      data.status = "RECEIVED";
      data.fulfilledVersionId = document.id;
    } else if (action === "reviewRecordRequest") {
      requireRole(actor, ["doctor"]);
      if (request.status !== "RECEIVED" || !request.fulfilledVersionId)
        throw new CareError(409, "Receive the requested records before clinical review.");
      data.status = "REVIEWED";
    } else throw new CareError(400, "Unknown records action.");
  }
  const changed = await tx.portalRecordRequest.updateMany({
    where: { id: request.id, version, status: request.status },
    data
  });
  if (changed.count !== 1)
    throw new CareError(409, "The records request changed. Refresh and try again.");
  if (action === "simulateRecordRequest") {
    await tx.portalOutbox.upsert({
      where: { dedupeKey: `records:${request.id}:send` },
      update: {},
      create: {
        encounterId,
        recipientUserId: request.providerUserId,
        recipientEmail: request.providerEmail,
        subject: "Consented previous-records request — simulation",
        body: "A scoped, consented records request is available in the secure demonstration portal. No email or records transfer was performed.",
        category: "RECORD_REQUEST",
        dedupeKey: `records:${request.id}:send`,
        createdById: actor.id
      }
    });
    if (request.providerUserId)
      await notify(
        tx,
        encounterId,
        request.providerUserId,
        "A consented records request is ready",
        "Open your assigned request and supply only the requested records.",
        "RECORDS",
        `records:${request.id}:sent`
      );
  }
  if (data.status === "RECEIVED" && request.assignedStaffId)
    await notify(
      tx,
      encounterId,
      request.assignedStaffId,
      "Previous records need clinical review",
      "A published records version has been supplied for your review.",
      "RECORDS",
      `records:${request.id}:received`
    );
  await audit(tx, actor, encounterId, `PORTAL_RECORDS_${data.status}`, request.reference);
  return {
    ok: true,
    recordRequest: await tx.portalRecordRequest.findUnique({ where: { id: request.id } })
  };
}

async function taskAction(
  tx: Db,
  actor: Actor,
  encounter: PortalEncounter,
  action: string,
  body: Record<string, unknown>
) {
  const encounterId = encounter.id;
  if (action === "createTask") {
    requireRole(actor, ["admin", "doctor", "nurse", "billing"]);
    const department = text(body.department, "Department", 100);
    const priority = optionalText(body.priority, "Priority", 20) || "NORMAL";
    if (
      !portalDepartments.some((item) => item === department) ||
      !["NORMAL", "HIGH", "URGENT"].includes(priority)
    )
      throw new CareError(400, "Choose a valid department and priority.");
    if (actor.role === "billing" && department !== "Billing")
      throw new CareError(403, "Billing can create only billing work items.");
    const assignee = await safeStaff(tx, body.assignedUserId, "Task owner");
    if (actor.role === "billing" && !["admin", "billing"].includes(assignee.role))
      throw new CareError(403, "Assign billing work to admissions or billing staff.");
    const task = await tx.portalTask.create({
      data: {
        encounterId,
        department,
        priority,
        title: text(body.title, "Work item", 500),
        assignedUserId: assignee.id,
        createdById: actor.id,
        dueAt: body.dueAt ? isoDate(body.dueAt, "due date") : null
      }
    });
    await notify(
      tx,
      encounterId,
      assignee.id,
      "Department work item assigned",
      "Open the patient-specific worklist to review the assigned item.",
      "TASK",
      `task:${task.id}:created`
    );
    await audit(tx, actor, encounterId, "PORTAL_TASK_CREATED", department);
    return { ok: true, task };
  }
  const task = await tx.portalTask.findFirst({
    where: { id: text(body.taskId, "Work item", 100), encounterId }
  });
  if (!task) throw new CareError(404, "Work item not found.");
  if (
    !isHospital(actor) &&
    !(actor.role === "billing" && task.department === "Billing") &&
    !(actor.role === "paramedic" && task.assignedUserId === actor.id)
  )
    throw new CareError(403, "Your role cannot update this work item.");
  const status = text(body.status, "Work item status", 30);
  if (!taskStatuses.some((item) => item === status))
    throw new CareError(400, "Choose a valid work item status.");
  const changed = await tx.portalTask.updateMany({
    where: { id: task.id, version: versionNumber(body.version) },
    data: { status, version: { increment: 1 } }
  });
  if (changed.count !== 1)
    throw new CareError(409, "The work item changed. Refresh and try again.");
  await audit(tx, actor, encounterId, `PORTAL_TASK_${status}`, task.department);
  return { ok: true, task: await tx.portalTask.findUnique({ where: { id: task.id } }) };
}

export async function portalAction(actor: Actor, body: Record<string, unknown>) {
  const action = text(body.action, "Action", 60);
  const encounterId = text(body.encounterId, "Encounter", 100);
  const encounter = await requirePortalEncounter(actor, encounterId);
  if (action === "assistant")
    return {
      ok: true,
      ...assistantResponse(actor, encounter, text(body.message, "Question", 2000))
    };
  if (action === "runChecks") {
    requireRole(actor, ["admin"]);
    await prisma.$queryRaw`SELECT 1`;
    const versions = await prisma.portalDocumentVersion.findMany({
      where: { document: { encounterId }, status: "PUBLISHED" },
      include: { files: true },
      take: 20
    });
    const integrity = versions.map((version) => ({
      id: version.id,
      title: version.title,
      valid: verifyVersionHash(version)
    }));
    return {
      ok: true,
      checkedAt: new Date().toISOString(),
      checks: [
        { name: "Database access", passed: true, detail: "A read-only database query succeeded." },
        {
          name: "Published document integrity",
          passed: integrity.every((item) => item.valid),
          detail: `${integrity.length} published versions checked; ${integrity.filter((item) => !item.valid).length} failed.`
        },
        {
          name: "External services",
          passed: true,
          detail: "Email, medical aid, identity and payment remain explicitly simulated."
        }
      ],
      documentIntegrity: integrity,
      commercialReady: false,
      limitations: [
        "These are bounded runtime checks, not the full automated test suite.",
        "Production identity, MFA, clinical access assignment, malware scanning, backups and contracted integrations need independent validation.",
        "Run the CI suite for API regression tests. A real-data pilot requires hospital approval and clinical/legal review."
      ]
    };
  }
  return prisma.$transaction(async (tx) => {
    const current = await requirePortalEncounter(actor, encounterId, tx);
    if (
      [
        "createConcern",
        "assignConcern",
        "respondConcern",
        "resolveConcern",
        "reopenConcern"
      ].includes(action)
    )
      return concernAction(tx, actor, current, action, body);
    if (
      [
        "requestRecords",
        "simulateRecordRequest",
        "fulfilRecordRequest",
        "reviewRecordRequest",
        "cancelRecordRequest"
      ].includes(action)
    )
      return recordAction(tx, actor, current, action, body);
    if (["createTask", "updateTask"].includes(action))
      return taskAction(tx, actor, current, action, body);
    if (action === "markNotification") {
      const updated = await tx.portalNotification.updateMany({
        where: {
          id: text(body.notificationId, "Notification", 100),
          encounterId,
          userId: actor.id
        },
        data: { readAt: new Date() }
      });
      if (updated.count !== 1) throw new CareError(404, "Notification not found.");
      return { ok: true };
    }
    throw new CareError(400, "Unknown portal action.");
  });
}
