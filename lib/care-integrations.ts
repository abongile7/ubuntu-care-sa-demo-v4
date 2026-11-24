import type { CareClaim, CareClaimLine, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  type Actor,
  CareError,
  audit,
  masked,
  moneyInteger,
  optionalText,
  ref,
  requireEncounter,
  requireRole,
  text,
  versionNumber
} from "@/lib/care-access";

type ClaimWithLines = CareClaim & { lineItems: CareClaimLine[] };
type Tx = Prisma.TransactionClient;

async function guardedClaimUpdate(
  tx: Tx,
  claim: CareClaim,
  version: number,
  data: Prisma.CareClaimUpdateManyMutationInput
) {
  const changed = await tx.careClaim.updateMany({
    where: { id: claim.id, status: claim.status, version },
    data
  });
  if (changed.count !== 1) throw new CareError(409, "The claim changed. Refresh and try again.");
}

function sharingConsent(
  body: Record<string, unknown>,
  patient: { consentDataSharing: boolean; popiaConsent: boolean }
) {
  if (body.consentConfirmed !== true || !patient.consentDataSharing || !patient.popiaConsent) {
    throw new CareError(
      409,
      "Record the patient's information-sharing consent and confirm the purpose before this simulated check."
    );
  }
  return text(body.purpose, "Purpose for accessing this information", 300);
}

function scenario(value: unknown, fallback: string, options: string[]) {
  const result = value === undefined ? fallback : text(value, "Simulation scenario", 40);
  if (!options.includes(result)) throw new CareError(400, "Choose a valid simulation scenario.");
  return result;
}

export function claimView(actor: Actor, claim: ClaimWithLines) {
  const common = {
    id: claim.id,
    reference: claim.reference,
    encounterId: claim.encounterId,
    scheme: claim.scheme,
    status: claim.status,
    version: claim.version,
    totalCents: claim.totalCents,
    patientLiabilityCents: claim.patientLiabilityCents,
    reviewNote: claim.reviewNote,
    submittedAt: claim.submittedAt,
    paidAt: claim.paidAt,
    simulated: true
  };
  if (actor.role === "patient") return common;
  if (actor.role === "insurer") {
    if (!claim.sharedWithInsurer || !actor.organization || claim.scheme !== actor.organization)
      throw new CareError(404, "Claim not found.");
    const packet = JSON.parse(claim.snapshotJson) as Record<string, unknown>;
    return {
      ...common,
      totalCents: packet.totalCents,
      memberNumberMasked: claim.memberNumberMasked,
      diagnosisCode: packet.diagnosisCode,
      authorizationReference: packet.authorizationReference,
      lineItems: packet.lineItems,
      packet
    };
  }
  return {
    ...common,
    diagnosisCode: claim.diagnosisCode,
    authorizationReference: claim.authorizationReference,
    memberNumberMasked: claim.memberNumberMasked,
    lineItems: claim.lineItems,
    sharedWithInsurer: claim.sharedWithInsurer,
    providerReference: claim.providerReference
  };
}

export async function integrationAction(actor: Actor, body: Record<string, unknown>) {
  const action = text(body.action, "Action", 60);
  if (
    !["verifyIdentity", "checkEligibility", "requestAuthorization", "simulateCall"].includes(action)
  )
    throw new CareError(400, "Unknown integration action.");
  requireRole(
    actor,
    action === "verifyIdentity"
      ? ["admin"]
      : action === "simulateCall"
        ? ["admin", "billing", "nurse", "doctor", "paramedic"]
        : ["admin", "billing"]
  );
  const encounterId = text(body.encounterId, "Encounter", 100);
  return prisma.$transaction(async (tx) => {
    const encounter = await requireEncounter(actor, encounterId, tx);
    const patient = encounter.patient;
    if (action === "simulateCall") {
      const purpose = text(body.purpose, "Call purpose", 30);
      const direction = text(body.direction, "Call direction", 30);
      if (
        !["EMS", "MEDICAL_AID", "NEXT_OF_KIN"].includes(purpose) ||
        !["INBOUND", "OUTBOUND"].includes(direction)
      )
        throw new CareError(400, "Choose a valid call purpose and direction.");
      if (
        (actor.role === "billing" && purpose !== "MEDICAL_AID") ||
        (actor.role === "paramedic" && purpose === "MEDICAL_AID")
      )
        throw new CareError(403, "This call purpose is outside your workspace.");
      const call = await tx.careCall.create({
        data: {
          encounterId,
          direction,
          purpose,
          contactName: text(body.contactName, "Contact name", 160),
          phone: text(body.phone, "Contact phone", 40),
          summary: text(body.summary, "Call notes", 2000),
          status: "SIMULATED_COMPLETED",
          providerReference: ref("SIM-CALL"),
          createdById: actor.id,
          createdByName: actor.name
        }
      });
      await audit(tx, actor, encounterId, "CALL_SIMULATED", purpose);
      return {
        ok: true,
        simulated: true,
        call,
        message: "Simulated call logged. No phone call was placed."
      };
    }
    if (action === "verifyIdentity") {
      if (!patient.popiaConsent || body.consentConfirmed !== true)
        throw new CareError(409, "Record privacy consent before identity verification.");
      const purpose = text(body.purpose, "Verification purpose", 300);
      const identity = patient.saId || patient.passportNumber;
      if (!identity)
        throw new CareError(
          409,
          "Add the fictional patient's identity or passport number before checking."
        );
      const chosen = scenario(body.scenario, "match", ["match", "mismatch", "unavailable"]);
      const check = await tx.careIdentityCheck.create({
        data: {
          encounterId,
          status: chosen === "match" ? "MATCH" : chosen === "mismatch" ? "NO_MATCH" : "UNAVAILABLE",
          providerReference: ref("SIM-DHA"),
          idLast4: identity.slice(-4),
          purpose,
          consentRecordedAt: new Date(),
          checkedById: actor.id
        }
      });
      await audit(tx, actor, encounterId, "IDENTITY_SIMULATED", check.status);
      return {
        ok: true,
        simulated: true,
        identityCheck: check,
        message: "Synthetic identity verification only; no Home Affairs records were queried."
      };
    }
    const purpose = sharingConsent(body, patient);
    if (action === "checkEligibility") {
      const chosen = scenario(body.scenario, "eligible", ["eligible", "not_found", "unavailable"]);
      const selfPay = patient.medicalAidScheme === "Self-pay / cash patient";
      const status = selfPay
        ? "SELF_PAY"
        : !patient.medicalAidNumber
          ? "INELIGIBLE"
          : chosen === "eligible"
            ? "ELIGIBLE"
            : chosen === "not_found"
              ? "INELIGIBLE"
              : "UNAVAILABLE";
      const check = await tx.careEligibilityCheck.create({
        data: {
          encounterId,
          scheme: patient.medicalAidScheme,
          memberNumberMasked: masked(patient.medicalAidNumber),
          status,
          authorizationStatus: selfPay ? "NOT_REQUIRED" : "NOT_REQUESTED",
          providerReference: ref("SIM-ELIG"),
          checkedById: actor.id
        }
      });
      await audit(tx, actor, encounterId, "ELIGIBILITY_SIMULATED", `${status}: ${purpose}`);
      return { ok: true, simulated: true, eligibilityCheck: check };
    }
    const check = await tx.careEligibilityCheck.findFirst({
      where: { encounterId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    if (
      !check ||
      check.status !== "ELIGIBLE" ||
      check.scheme !== patient.medicalAidScheme ||
      check.memberNumberMasked !== masked(patient.medicalAidNumber)
    )
      throw new CareError(
        409,
        "Run a successful eligibility check for the current membership before requesting authorisation."
      );
    const chosen = scenario(body.scenario, "approved", ["approved", "declined", "unavailable"]);
    const updated = await tx.careEligibilityCheck.update({
      where: { id: check.id },
      data: {
        authorizationStatus:
          chosen === "approved" ? "APPROVED" : chosen === "declined" ? "DECLINED" : "UNAVAILABLE",
        authorizationReference: chosen === "approved" ? ref("SIM-AUTH") : "",
        checkedById: actor.id
      }
    });
    await audit(
      tx,
      actor,
      encounterId,
      "AUTHORIZATION_SIMULATED",
      `${updated.authorizationStatus}: ${purpose}`
    );
    return { ok: true, simulated: true, eligibilityCheck: updated };
  });
}

async function claimChecks(tx: Tx, encounterId: string, claim: ClaimWithLines) {
  const encounter = await tx.careEncounter.findUniqueOrThrow({
    where: { id: encounterId },
    include: { patient: true }
  });
  const eligibility = await tx.careEligibilityCheck.findFirst({
    where: { encounterId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }]
  });
  const errors: string[] = [];
  if (encounter.status !== "DISCHARGED")
    errors.push("Complete the discharge workflow before submitting this final hospital claim.");
  if (!encounter.dischargeSummary.trim())
    errors.push("The doctor must complete the discharge summary.");
  if (!encounter.diagnosisCode.trim()) errors.push("A diagnosis code is required.");
  if (!encounter.patient.consentDataSharing || !encounter.patient.popiaConsent)
    errors.push("Record consent to share the claim with the medical aid.");
  if (claim.scheme === "Self-pay / cash patient")
    errors.push("Self-pay accounts cannot be submitted as medical-aid claims.");
  if (
    claim.scheme !== encounter.patient.medicalAidScheme ||
    claim.memberNumberMasked !== masked(encounter.patient.medicalAidNumber)
  )
    errors.push("Membership details changed; prepare a new claim for the current membership.");
  if (
    !eligibility ||
    eligibility.status !== "ELIGIBLE" ||
    eligibility.authorizationStatus !== "APPROVED" ||
    eligibility.scheme !== claim.scheme ||
    eligibility.memberNumberMasked !== claim.memberNumberMasked
  )
    errors.push("Run current eligibility and obtain a simulated authorisation.");
  if (!claim.lineItems.length) errors.push("Add at least one invoice line.");
  const totalCents = claim.lineItems.reduce(
    (sum, line) => sum + line.quantity * line.unitPriceCents,
    0
  );
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0 || totalCents > 100_000_000)
    errors.push("Invoice total must be greater than zero and within the demo limit of R1,000,000.");
  return { encounter, eligibility, errors, totalCents };
}

async function findClaim(tx: Tx, actor: Actor, body: Record<string, unknown>) {
  const encounterId = text(body.encounterId, "Encounter", 100);
  await requireEncounter(actor, encounterId, tx);
  const claim = await tx.careClaim.findFirst({
    where: {
      id: text(body.claimId, "Claim", 100),
      encounterId,
      ...(actor.role === "insurer"
        ? { scheme: actor.organization ?? "", sharedWithInsurer: true }
        : {})
    },
    include: { lineItems: { orderBy: { createdAt: "asc" } } }
  });
  if (!claim) throw new CareError(404, "Claim not found.");
  return claim;
}

export async function claimAction(actor: Actor, body: Record<string, unknown>) {
  const action = text(body.action, "Action", 50);
  requireRole(actor, action === "review" ? ["insurer"] : ["admin", "billing"]);
  const encounterId = text(body.encounterId, "Encounter", 100);
  return prisma.$transaction(async (tx) => {
    const encounter = await requireEncounter(actor, encounterId, tx);
    if (action === "create") {
      if (await tx.careClaim.count({ where: { encounterId, status: { not: "REJECTED" } } }))
        throw new CareError(409, "This encounter already has an active claim.");
      const claim = await tx.careClaim.create({
        data: {
          reference: ref("CLM"),
          encounterId,
          scheme: encounter.patient.medicalAidScheme,
          memberNumberMasked: masked(encounter.patient.medicalAidNumber),
          diagnosisCode: encounter.diagnosisCode,
          createdById: actor.id
        },
        include: { lineItems: true }
      });
      await audit(tx, actor, encounterId, "CLAIM_CREATED");
      return { ok: true, claim: claimView(actor, claim) };
    }
    const claim = await findClaim(tx, actor, body);
    const version = versionNumber(body.version);
    if (version !== claim.version)
      throw new CareError(409, "The claim changed. Refresh and try again.");
    if (["addLine", "removeLine"].includes(action)) {
      if (!["DRAFT", "NEEDS_INFORMATION"].includes(claim.status))
        throw new CareError(409, "Only draft or returned claims can be edited.");
      if (action === "addLine") {
        const quantity = body.quantity;
        if (
          typeof quantity !== "number" ||
          !Number.isInteger(quantity) ||
          quantity < 1 ||
          quantity > 1000
        )
          throw new CareError(400, "Quantity must be a whole number between 1 and 1000.");
        const unitPriceCents = moneyInteger(body.unitPriceCents, "Unit price");
        const totalCents = quantity * unitPriceCents;
        if (totalCents <= 0 || totalCents > 100_000_000)
          throw new CareError(
            400,
            "Line total must be greater than zero and no more than R1,000,000."
          );
        await tx.careClaimLine.create({
          data: {
            claimId: claim.id,
            serviceCode: text(body.serviceCode, "Service code", 40),
            description: text(body.description, "Service description", 300),
            quantity,
            unitPriceCents,
            totalCents
          }
        });
      } else {
        const removed = await tx.careClaimLine.deleteMany({
          where: { id: text(body.lineId, "Invoice line", 100), claimId: claim.id }
        });
        if (!removed.count) throw new CareError(404, "Invoice line not found.");
      }
      const lines = await tx.careClaimLine.findMany({ where: { claimId: claim.id } });
      const totalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
      if (totalCents > 100_000_000)
        throw new CareError(400, "The invoice exceeds the demo limit of R1,000,000.");
      await guardedClaimUpdate(tx, claim, version, { totalCents, version: { increment: 1 } });
      await audit(tx, actor, encounterId, "CLAIM_LINES_UPDATED");
    } else if (action === "validate" || action === "submit") {
      if (
        !(
          action === "validate" ? ["DRAFT", "NEEDS_INFORMATION", "VALIDATED"] : ["VALIDATED"]
        ).includes(claim.status)
      )
        throw new CareError(
          409,
          action === "submit"
            ? "Validate this claim before submission. A submitted claim cannot be sent twice."
            : "This claim cannot be validated in its current state."
        );
      const checks = await claimChecks(tx, encounterId, claim);
      if (checks.errors.length) return { ok: true, valid: false, errors: checks.errors };
      const packet = {
        simulated: true,
        claimReference: claim.reference,
        encounterReference: checks.encounter.reference,
        patient: {
          fullName: checks.encounter.patient.fullName,
          facilityFileNumber: checks.encounter.patient.facilityFileNumber
        },
        scheme: claim.scheme,
        memberNumberMasked: claim.memberNumberMasked,
        diagnosisCode: checks.encounter.diagnosisCode,
        authorizationReference: checks.eligibility!.authorizationReference,
        admittedAt: checks.encounter.openedAt,
        dischargedAt: checks.encounter.closedAt,
        dischargeSummaryAvailable: true,
        lineItems: claim.lineItems.map(
          ({ id, serviceCode, description, quantity, unitPriceCents, totalCents }) => ({
            id,
            serviceCode,
            description,
            quantity,
            unitPriceCents,
            totalCents
          })
        ),
        totalCents: checks.totalCents,
        currency: "ZAR"
      };
      const updated = await tx.careClaim.updateMany({
        where: { id: claim.id, version, status: claim.status },
        data: {
          status: action === "validate" ? "VALIDATED" : "SUBMITTED",
          diagnosisCode: checks.encounter.diagnosisCode,
          authorizationReference: checks.eligibility!.authorizationReference,
          totalCents: checks.totalCents,
          version: { increment: 1 },
          ...(action === "submit"
            ? {
                snapshotJson: JSON.stringify(packet),
                sharedWithInsurer: true,
                providerReference: ref("SIM-CLAIM"),
                submittedAt: new Date()
              }
            : {})
        }
      });
      if (updated.count !== 1)
        throw new CareError(409, "The claim changed. Refresh and try again.");
      await audit(
        tx,
        actor,
        encounterId,
        action === "submit" ? "CLAIM_SUBMITTED_SIMULATED" : "CLAIM_VALIDATED"
      );
    } else if (action === "review") {
      if (claim.status !== "SUBMITTED")
        throw new CareError(409, "Only submitted claims await medical-aid review.");
      const decision = text(body.decision, "Review decision", 40);
      if (!["APPROVED", "REJECTED", "NEEDS_INFORMATION"].includes(decision))
        throw new CareError(400, "Choose a valid review decision.");
      const reviewNote =
        decision === "APPROVED"
          ? optionalText(body.note, "Review note", 1000)
          : text(body.note, "Reason or requested information", 1000);
      await guardedClaimUpdate(tx, claim, version, {
        status: decision,
        reviewNote,
        version: { increment: 1 }
      });
      await audit(tx, actor, encounterId, `CLAIM_${decision}_SIMULATED`);
    } else if (action === "pay") {
      if (await tx.claimRemittance.count({ where: { claimId: claim.id } })) throw new CareError(409, "Continue reconciliation in the paperless workspace.");
      if (claim.status !== "APPROVED")
        throw new CareError(
          409,
          "Medical-aid approval is required before recording a simulated payment."
        );
      await guardedClaimUpdate(tx, claim, version, {
        status: "PAID",
        paidAt: new Date(),
        providerReference: ref("SIM-PAYMENT"),
        version: { increment: 1 }
      });
      await audit(tx, actor, encounterId, "CLAIM_PAID_SIMULATED");
    } else throw new CareError(400, "Unknown claim action.");
    const updated = await tx.careClaim.findUniqueOrThrow({
      where: { id: claim.id },
      include: { lineItems: { orderBy: { createdAt: "asc" } } }
    });
    return { ok: true, valid: true, errors: [], claim: claimView(actor, updated), simulated: true };
  });
}

export async function exportClaim(actor: Actor, claimId: string) {
  requireRole(actor, ["admin", "billing", "insurer"]);
  const claim = await prisma.careClaim.findFirst({
    where: {
      id: claimId,
      ...(actor.role === "insurer"
        ? { scheme: actor.organization ?? "", sharedWithInsurer: true }
        : {})
    },
    include: { lineItems: true }
  });
  if (!claim) throw new CareError(404, "Claim not found.");
  await requireEncounter(actor, claim.encounterId);
  if (!claim.sharedWithInsurer)
    throw new CareError(409, "Submit the claim to create its consented export packet.");
  return {
    simulated: true,
    status: claim.status,
    packet: JSON.parse(claim.snapshotJson) as Record<string, unknown>
  };
}
