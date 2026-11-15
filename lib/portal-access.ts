import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { type Actor, CareError, encounterWhere } from "@/lib/care-access";

type Db = Prisma.TransactionClient;
export const hospitalRoles: readonly Role[] = ["admin", "doctor", "nurse"];
export const isHospital = (actor: Actor) => hospitalRoles.includes(actor.role);

export function portalEncounterWhere(actor: Actor): Prisma.CareEncounterWhereInput {
  if (actor.role !== "referring_doctor") return encounterWhere(actor);
  return {
    patient: { popiaConsent: true },
    portalRecordRequests: {
      some: {
        providerUserId: actor.id,
        status: { notIn: ["CANCELLED", "EXPIRED"] },
        expiresAt: { gt: new Date() }
      }
    }
  };
}

export async function requirePortalEncounter(actor: Actor, id: string, tx: Db = prisma) {
  if (typeof id !== "string" || !id.trim()) throw new CareError(400, "Select a patient encounter.");
  const encounter = await tx.careEncounter.findFirst({
    where: { AND: [{ id }, portalEncounterWhere(actor)] },
    include: { patient: true }
  });
  if (!encounter) throw new CareError(404, "Encounter not found.");
  return encounter;
}

export type PortalEncounter = Awaited<ReturnType<typeof requirePortalEncounter>>;
type DocumentScope = {
  encounterId?: string;
  visibility: string;
  recordRequestId?: string | null;
  claimId?: string | null;
  createdById?: string;
};

export async function canAccessDocument(
  actor: Actor,
  encounter: PortalEncounter,
  document: DocumentScope,
  tx: Db = prisma
): Promise<boolean> {
  if (document.encounterId && document.encounterId !== encounter.id) return false;
  if (isHospital(actor)) return true;
  if (actor.role === "patient") {
    return (
      encounter.patient.userId === actor.id &&
      ["PATIENT", "CLAIM", "RECORD_REQUEST"].includes(document.visibility)
    );
  }
  if (actor.role === "billing") return document.visibility === "CLAIM";
  if (actor.role === "paramedic")
    return document.visibility === "HANDOVER" && encounter.crewUserId === actor.id;
  if (actor.role === "insurer") {
    if (
      document.visibility !== "CLAIM" ||
      !document.claimId ||
      !actor.organization ||
      !encounter.patient.consentDataSharing ||
      !encounter.patient.popiaConsent
    )
      return false;
    return Boolean(
      await tx.careClaim.findFirst({
        where: {
          id: document.claimId,
          encounterId: encounter.id,
          scheme: actor.organization,
          sharedWithInsurer: true
        },
        select: { id: true }
      })
    );
  }
  if (actor.role === "referring_doctor") {
    if (
      document.visibility !== "RECORD_REQUEST" ||
      !document.recordRequestId ||
      !encounter.patient.popiaConsent
    )
      return false;
    return Boolean(
      await tx.portalRecordRequest.findFirst({
        where: {
          id: document.recordRequestId,
          encounterId: encounter.id,
          providerUserId: actor.id,
          status: { notIn: ["CANCELLED", "EXPIRED"] },
          expiresAt: { gt: new Date() }
        },
        select: { id: true }
      })
    );
  }
  return false;
}

export async function requireDocumentAccess(
  actor: Actor,
  encounter: PortalEncounter,
  document: DocumentScope,
  tx: Db = prisma
) {
  if (!(await canAccessDocument(actor, encounter, document, tx)))
    throw new CareError(404, "Document not found.");
}

export async function portalContacts(actor: Actor, encounter: PortalEncounter, tx: Db = prisma) {
  const allowed = new Set<string>();
  if (actor.role === "referring_doctor") {
    const requests = await tx.portalRecordRequest.findMany({
      where: {
        encounterId: encounter.id,
        providerUserId: actor.id,
        status: { notIn: ["CANCELLED", "EXPIRED"] },
        expiresAt: { gt: new Date() }
      }
    });
    for (const request of requests) {
      allowed.add(request.createdById);
      if (request.assignedStaffId) allowed.add(request.assignedStaffId);
    }
    allowed.add(encounter.patient.userId);
  } else {
    const roles: Role[] =
      actor.role === "paramedic"
        ? ["admin", "doctor", "nurse"]
        : ["admin", "doctor", "nurse", "billing"];
    if (actor.role !== "insurer") {
      const staff = await tx.user.findMany({
        where: { role: { in: roles } },
        select: { id: true }
      });
      for (const user of staff) allowed.add(user.id);
    } else {
      const staff = await tx.user.findMany({
        where: { role: { in: ["admin", "doctor", "nurse", "billing"] } },
        select: { id: true }
      });
      for (const user of staff) allowed.add(user.id);
    }
    if (actor.role !== "paramedic") allowed.add(encounter.patient.userId);
    if (isHospital(actor) && encounter.crewUserId) allowed.add(encounter.crewUserId);
    if (actor.role !== "paramedic" && actor.role !== "insurer") {
      const grants = await tx.portalRecordRequest.findMany({
        where: {
          encounterId: encounter.id,
          status: { notIn: ["CANCELLED", "EXPIRED"] },
          expiresAt: { gt: new Date() },
          providerUserId: { not: null }
        },
        select: { providerUserId: true }
      });
      for (const grant of grants) if (grant.providerUserId) allowed.add(grant.providerUserId);
    }
    if (
      actor.role !== "paramedic" &&
      encounter.patient.consentDataSharing &&
      encounter.patient.popiaConsent
    ) {
      const schemes = await tx.careClaim.findMany({
        where: { encounterId: encounter.id, sharedWithInsurer: true },
        select: { scheme: true }
      });
      const insurers = await tx.user.findMany({
        where: { role: "insurer", organization: { in: schemes.map((item) => item.scheme) } },
        select: { id: true }
      });
      for (const user of insurers) allowed.add(user.id);
    }
  }
  allowed.delete(actor.id);
  return tx.user.findMany({
    where: { id: { in: [...allowed] } },
    select: { id: true, name: true, role: true, organization: true },
    orderBy: { name: "asc" }
  });
}
