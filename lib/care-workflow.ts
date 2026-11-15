import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import type { PatientProfile, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  type Actor,
  CareError,
  requireRole,
  requireEncounter,
  encounterWhere,
  audit,
  ref,
  text,
  optionalText,
  versionNumber,
  masked
} from "@/lib/care-access";
import { encounterStatuses, transitionRoles, serviceModes } from "@/lib/care-constants";
import { claimView } from "@/lib/care-integrations";
import { medicationRoutes } from "@/lib/demo-data";

function patientSummary(patient: PatientProfile) {
  return {
    id: patient.id,
    fullName: patient.fullName,
    facilityFileNumber: patient.facilityFileNumber,
    medicalAidScheme: patient.medicalAidScheme
  };
}

export async function journeyDashboard(actor: Actor, requestedId?: string | null) {
  const encounters = await prisma.careEncounter.findMany({
    where: encounterWhere(actor),
    include: { patient: true },
    orderBy: { openedAt: "desc" },
    take: 100
  });
  const selected = requestedId ? encounters.find((item) => item.id === requestedId) : encounters[0];
  if (requestedId && !selected) throw new CareError(404, "Encounter not found.");
  const hospital = ["admin", "doctor", "nurse"].includes(actor.role);
  const finance = ["admin", "billing"].includes(actor.role);
  const patients = ["admin", "doctor", "nurse", "billing"].includes(actor.role)
    ? (await prisma.patientProfile.findMany({ orderBy: { fullName: "asc" }, take: 200 })).map(
        patientSummary
      )
    : [];
  const crew =
    actor.role === "admin"
      ? await prisma.user.findMany({
          where: { role: "paramedic" },
          select: { id: true, name: true }
        })
      : [];
  const base = {
    ok: true,
    session: actor,
    patients,
    crew,
    services: serviceModes,
    encounters: encounters.map((item) => ({
      id: item.id,
      reference: item.reference,
      status: item.status,
      version: item.version,
      openedAt: item.openedAt,
      patient: patientSummary(item.patient)
    }))
  };
  if (!selected)
    return {
      ...base,
      activeEncounter: null,
      calls: [],
      notes: [],
      labOrders: [],
      identityChecks: [],
      eligibilityChecks: [],
      claims: [],
      audit: [],
      vitals: [],
      medications: [],
      administrations: []
    };
  const encounterId = selected.id;
  const [calls, notes, labs, identities, eligibility, claims, events] = await Promise.all([
    actor.role === "insurer" || actor.role === "patient"
      ? []
      : prisma.careCall.findMany({
          where: {
            encounterId,
            ...(actor.role === "billing"
              ? { purpose: "MEDICAL_AID" }
              : actor.role === "paramedic"
                ? { purpose: { in: ["EMS", "NEXT_OF_KIN"] } }
                : {})
          },
          orderBy: { createdAt: "desc" },
          take: 100
        }),
    hospital || actor.role === "paramedic" || actor.role === "patient"
      ? prisma.careNote.findMany({
          where: {
            encounterId,
            ...(actor.role === "paramedic"
              ? { category: "Handover" }
              : actor.role === "patient"
                ? { category: "Patient update" }
                : {})
          },
          orderBy: { createdAt: "desc" },
          take: 100
        })
      : [],
    hospital || actor.role === "patient"
      ? prisma.careLabOrder.findMany({
          where: { encounterId, ...(actor.role === "patient" ? { status: "REVIEWED" } : {}) },
          orderBy: { createdAt: "desc" },
          take: 100
        })
      : [],
    actor.role === "admin"
      ? prisma.careIdentityCheck.findMany({
          where: { encounterId },
          orderBy: { createdAt: "desc" },
          take: 30
        })
      : [],
    finance
      ? prisma.careEligibilityCheck.findMany({
          where: { encounterId },
          orderBy: { createdAt: "desc" },
          take: 30
        })
      : [],
    finance || actor.role === "patient" || actor.role === "insurer"
      ? prisma.careClaim.findMany({
          where: {
            encounterId,
            ...(actor.role === "insurer"
              ? { scheme: actor.organization ?? "", sharedWithInsurer: true }
              : {})
          },
          include: { lineItems: { orderBy: { createdAt: "asc" } } },
          orderBy: { createdAt: "desc" },
          take: 50
        })
      : [],
    actor.role === "insurer"
      ? []
      : prisma.careAuditEvent.findMany({
          where: { encounterId },
          orderBy: { createdAt: "asc" },
          take: 200
        })
  ]);
  const patient = selected.patient;
  const publicEncounter = {
    id: selected.id,
    reference: selected.reference,
    status: selected.status,
    version: selected.version,
    patientId: patient.id,
    patient: patientSummary(patient),
    openedAt: selected.openedAt,
    closedAt: selected.closedAt
  };
  const activeEncounter =
    actor.role === "insurer"
      ? publicEncounter
      : {
          ...publicEncounter,
          triage: selected.triage,
          ward: selected.ward,
          bed: selected.bed,
          ...(actor.role !== "billing"
            ? {
                chiefComplaint: selected.chiefComplaint,
                location: selected.location,
                crewUserId: selected.crewUserId
              }
            : {}),
          ...(hospital || actor.role === "patient"
            ? {
                clinicalSummary: selected.clinicalSummary,
                dischargeSummary: selected.dischargeSummary,
                diagnosisCode: selected.diagnosisCode
              }
            : {}),
          ...(finance
            ? {
                diagnosisCode: selected.diagnosisCode,
                hasDischargeSummary: Boolean(selected.dischargeSummary)
              }
            : {}),
          patient: {
            ...patientSummary(patient),
            ...(hospital || actor.role === "paramedic" || actor.role === "patient"
              ? {
                  allergies: patient.allergies,
                  chronicConditions: patient.chronicConditions,
                  phone: patient.phone
                }
              : {}),
            ...(finance || actor.role === "patient"
              ? {
                  memberNumberMasked: masked(patient.medicalAidNumber),
                  consentDataSharing: patient.consentDataSharing,
                  popiaConsent: patient.popiaConsent,
                  consentTreatment: patient.consentTreatment
                }
              : {})
          }
        };
  const visibleEvents =
    actor.role === "patient" || actor.role === "paramedic"
      ? events
          .filter((event) => event.action.startsWith("STATUS_"))
          .map(({ id, action, createdAt }) => ({ id, action, createdAt }))
      : actor.role === "billing"
        ? events.filter((event) => /^(CLAIM_|ELIGIBILITY_|AUTHORIZATION_|CALL_)/.test(event.action))
        : events;
  const [vitals, medications, administrations] =
    hospital || actor.role === "patient"
      ? await Promise.all([
          prisma.vitalRecord.findMany({
            where: { patientId: patient.id },
            orderBy: { recordedAt: "desc" },
            take: 12
          }),
          prisma.medicationOrder.findMany({
            where: { patientId: patient.id },
            orderBy: { prescribedAt: "desc" },
            take: 50
          }),
          prisma.medicationAdministration.findMany({
            where: { patientId: patient.id },
            orderBy: { administeredAt: "desc" },
            take: 50
          })
        ])
      : [[], [], []];
  return {
    ...base,
    activeEncounter,
    calls,
    notes,
    labOrders: labs,
    identityChecks: identities,
    eligibilityChecks: eligibility,
    claims: claims.map((claim) => claimView(actor, claim)),
    audit: visibleEvents,
    vitals,
    medications,
    administrations
  };
}

function active(status: string) {
  if (["READY_FOR_DISCHARGE", "DISCHARGED"].includes(status))
    throw new CareError(409, "This encounter is closed to new clinical entries.");
}

async function registerPatient(actor: Actor, body: Record<string, unknown>) {
  requireRole(actor, ["admin"]);
  const fullName = text(body.fullName, "Full name", 160);
  const email = text(body.email, "Email", 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new CareError(400, "Enter a valid email address.");
  const birthday = text(body.dateOfBirth, "Date of birth", 10);
  const dateOfBirth = new Date(birthday);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(birthday) ||
    Number.isNaN(dateOfBirth.getTime()) ||
    dateOfBirth.toISOString().slice(0, 10) !== birthday ||
    dateOfBirth > new Date() ||
    dateOfBirth.getUTCFullYear() < 1900
  )
    throw new CareError(400, "Enter a valid date of birth.");
  const saId = optionalText(body.saId, "Identity number", 20);
  const passportNumber = optionalText(body.passportNumber, "Passport", 30);
  if (!saId && !passportNumber)
    throw new CareError(
      400,
      "An identity or passport number is required for this fictional registration."
    );
  if (await prisma.user.findUnique({ where: { email } }))
    throw new CareError(409, "This email already has a record.");
  const passwordHash = await bcrypt.hash(randomUUID(), 10);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { name: fullName, email, role: "patient", unit: "Admissions", passwordHash }
    });
    const emptyFields = {
      citizenship: "",
      gender: "",
      language: "",
      preferredContactMethod: "Email",
      province: "",
      city: "",
      address: "",
      postalCode: "",
      maritalStatus: "",
      occupation: "",
      employer: "",
      employerPhone: "",
      religion: "",
      homeClinic: "",
      arrivalMode: "Ambulance",
      arrivalReason: "",
      broughtBy: "",
      referralSource: "",
      referringDoctor: "",
      transferredFrom: "",
      transferReason: "",
      medicalAidPlan: "",
      membershipTier: "",
      principalMemberName: fullName,
      principalMemberNumber: "",
      relationshipToPrincipalMember: "Self",
      nextOfKin: "",
      nextOfKinRelation: "",
      nextOfKinPhone: "",
      guardianName: "",
      guardianPhone: "",
      bloodType: "",
      allergies: "Not yet assessed",
      currentMedication: "",
      chronicConditions: "",
      disabilitySupport: "",
      pregnancyStatus: "",
      visitPathway: "Emergency",
      triagePriority: "Unassessed",
      ward: "",
      bedNumber: ""
    };
    const patient = await tx.patientProfile.create({
      data: {
        ...emptyFields,
        userId: user.id,
        facilityFileNumber: ref("UC"),
        fullName,
        email,
        dateOfBirth,
        saId,
        passportNumber,
        phone: text(body.phone, "Phone", 40),
        medicalAidScheme:
          optionalText(body.medicalAidScheme, "Medical aid", 160) || "Self-pay / cash patient",
        medicalAidNumber: optionalText(body.medicalAidNumber, "Membership number", 80),
        consentDataSharing: body.consentDataSharing === true,
        popiaConsent: body.popiaConsent === true,
        consentTreatment: body.consentTreatment === true
      }
    });
    await audit(tx, actor, null, "PATIENT_REGISTERED", "Fictional patient profile registered.");
    return { ok: true, patient: patientSummary(patient) };
  });
}

export async function journeyAction(actor: Actor, body: Record<string, unknown>) {
  const action = text(body.action, "Action", 60);
  if (action === "registerPatient") return registerPatient(actor, body);
  if (action === "createEncounter") {
    requireRole(actor, ["admin"]);
    const patientId = text(body.patientId, "Patient", 100);
    const patient = await prisma.patientProfile.findUnique({ where: { id: patientId } });
    if (!patient) throw new CareError(404, "Patient not found.");
    const crewUserId = optionalText(body.crewUserId, "Ambulance crew", 100) || null;
    if (
      crewUserId &&
      !(await prisma.user.findFirst({ where: { id: crewUserId, role: "paramedic" } }))
    )
      throw new CareError(400, "Choose an ambulance crew.");
    const triage = optionalText(body.triage, "Triage", 20) || "Yellow";
    if (!["Red", "Orange", "Yellow", "Green"].includes(triage))
      throw new CareError(400, "Choose a triage priority.");
    return prisma.$transaction(async (tx) => {
      const encounter = await tx.careEncounter.create({
        data: {
          reference: ref("ENC"),
          patientId,
          crewUserId,
          chiefComplaint: text(body.chiefComplaint, "Reason for care", 1000),
          location: text(body.location, "Pickup location", 300),
          triage,
          createdById: actor.id
        }
      });
      await audit(tx, actor, encounter.id, "ENCOUNTER_CREATED");
      return { ok: true, encounter };
    });
  }
  const encounterId = text(body.encounterId, "Encounter", 100);
  return prisma.$transaction(async (tx) => {
    const encounter = await requireEncounter(actor, encounterId, tx);
    if (action === "recordConsent") {
      requireRole(actor, ["admin", "patient"]);
      for (const field of ["popiaConsent", "consentDataSharing", "consentTreatment"]) {
        if (typeof body[field] !== "boolean")
          throw new CareError(400, "Specify each consent choice explicitly.");
      }
      await tx.patientProfile.update({
        where: { id: encounter.patientId },
        data: {
          popiaConsent: body.popiaConsent as boolean,
          consentDataSharing: body.consentDataSharing as boolean,
          consentTreatment: body.consentTreatment as boolean
        }
      });
      await audit(
        tx,
        actor,
        encounterId,
        "CONSENT_UPDATED",
        "Privacy, treatment and information-sharing choices recorded."
      );
      return { ok: true };
    }
    if (action === "transition") {
      const status = text(body.status, "Next stage", 40);
      const currentIndex = encounterStatuses.indexOf(
        encounter.status as (typeof encounterStatuses)[number]
      );
      if (currentIndex < 0 || encounterStatuses[currentIndex + 1] !== status)
        throw new CareError(409, "Complete the current stage before moving to the next stage.");
      requireRole(actor, transitionRoles[status] ?? []);
      const version = versionNumber(body.version);
      const data: Prisma.CareEncounterUpdateManyMutationInput = {
        status,
        version: { increment: 1 }
      };
      if (status === "DISPATCHED" && !encounter.crewUserId)
        throw new CareError(409, "Assign an ambulance crew when creating the encounter.");
      if (
        status === "HANDED_OVER" &&
        !(await tx.careNote.count({ where: { encounterId, category: "Handover" } }))
      )
        throw new CareError(409, "Record a handover note before hospital handover.");
      if (status === "ADMITTED") {
        data.ward = text(body.ward, "Ward", 80);
        data.bed = text(body.bed, "Bed", 40);
      }
      if (status === "READY_FOR_DISCHARGE") {
        const diagnosis = text(body.diagnosisCode, "Diagnosis code", 20).toUpperCase();
        if (!/^[A-Z][0-9]{2}(?:\.[A-Z0-9]{1,4})?$/.test(diagnosis))
          throw new CareError(
            400,
            "Use a diagnosis code such as R51. Codes require clinical validation before real use."
          );
        data.diagnosisCode = diagnosis;
        data.clinicalSummary = text(body.clinicalSummary, "Clinical summary", 5000);
        data.dischargeSummary = text(body.dischargeSummary, "Discharge instructions", 5000);
        if (
          await tx.careLabOrder.count({
            where: { encounterId, status: { notIn: ["REVIEWED", "CANCELLED"] } }
          })
        )
          throw new CareError(
            409,
            "Review or cancel pending laboratory orders before discharge readiness."
          );
      }
      if (status === "DISCHARGED") data.closedAt = new Date();
      const changed = await tx.careEncounter.updateMany({
        where: { id: encounterId, status: encounter.status, version },
        data
      });
      if (changed.count !== 1)
        throw new CareError(409, "The encounter changed. Refresh and try again.");
      if (status === "ADMITTED")
        await tx.patientProfile.update({
          where: { id: encounter.patientId },
          data: {
            ward: String(data.ward),
            bedNumber: String(data.bed),
            triagePriority: encounter.triage
          }
        });
      await audit(tx, actor, encounterId, `STATUS_${status}`);
      return {
        ok: true,
        encounter: await tx.careEncounter.findUnique({ where: { id: encounterId } })
      };
    }
    if (action === "addNote") {
      requireRole(actor, ["doctor", "nurse", "paramedic"]);
      active(encounter.status);
      const category = text(body.category, "Note type", 40);
      if (!["Clinical", "Handover", "Patient update"].includes(category))
        throw new CareError(400, "Choose a valid note type.");
      if (
        actor.role === "paramedic" &&
        (category !== "Handover" ||
          !["REQUESTED", "DISPATCHED", "ON_SCENE", "IN_TRANSIT"].includes(encounter.status))
      )
        throw new CareError(
          403,
          "Ambulance crews may record handover notes during their assigned transport."
        );
      const note = await tx.careNote.create({
        data: {
          encounterId,
          category,
          body: text(body.body, "Note", 5000),
          authorId: actor.id,
          authorName: actor.name,
          authorRole: actor.role
        }
      });
      await audit(tx, actor, encounterId, "NOTE_ADDED", category);
      return { ok: true, note };
    }
    if (["recordVitals", "prescribeMedication", "administerMedication"].includes(action)) {
      requireRole(actor, action === "prescribeMedication" ? ["doctor"] : ["doctor", "nurse"]);
      if (!["ADMITTED", "IN_CARE"].includes(encounter.status))
        throw new CareError(409, "Clinical charting requires an admitted patient in active care.");
      if (action === "recordVitals") {
        function observation(field: string, min: number, max: number, integer = true) {
          const value = body[field];
          if (
            typeof value !== "number" ||
            !Number.isFinite(value) ||
            (integer && !Number.isInteger(value)) ||
            value < min ||
            value > max
          )
            throw new CareError(400, `Enter a valid ${field} observation.`);
          return value;
        }
        const vital = await tx.vitalRecord.create({
          data: {
            reference: ref("VTL"),
            patientId: encounter.patientId,
            recordedBy: actor.name,
            recordedByRole: actor.role,
            recordedAt: new Date(),
            systolic: observation("systolic", 1, 300),
            diastolic: observation("diastolic", 1, 200),
            pulse: observation("pulse", 1, 300),
            temperature: observation("temperature", 25, 45, false),
            spo2: observation("spo2", 1, 100),
            respiratoryRate: observation("respiratoryRate", 1, 80),
            painScore: observation("painScore", 0, 10),
            glucose: optionalText(body.glucose, "Glucose", 100),
            notes: optionalText(body.notes, "Notes", 2000)
          }
        });
        await audit(tx, actor, encounterId, "VITALS_RECORDED", vital.reference);
        return { ok: true };
      }
      if (action === "prescribeMedication") {
        const route = optionalText(body.route, "Medication route", 50) || "Oral";
        if (!medicationRoutes.some((item) => item === route))
          throw new CareError(400, "Choose a valid medication route.");
        const order = await tx.medicationOrder.create({
          data: {
            reference: ref("MED"),
            patientId: encounter.patientId,
            prescribedBy: actor.name,
            prescribedByRole: actor.role,
            drugName: text(body.drugName, "Medication", 200),
            dose: text(body.dose, "Dose", 100),
            route,
            frequency: text(body.frequency, "Frequency", 100),
            indication: optionalText(body.indication, "Indication", 300),
            startDate: new Date(),
            status: "Active"
          }
        });
        await audit(tx, actor, encounterId, "MEDICATION_PRESCRIBED", order.reference);
        return { ok: true };
      }
      const order = await tx.medicationOrder.findUnique({
        where: { id: text(body.orderId, "Medication order", 100) }
      });
      if (!order) throw new CareError(404, "Medication order not found.");
      if (order.patientId !== encounter.patientId)
        throw new CareError(400, "Medication order does not belong to this encounter's patient.");
      if (order.status !== "Active") throw new CareError(409, "Only active orders can be charted.");
      const status = text(body.status, "Administration status", 30);
      if (!["Given", "Withheld", "Missed"].includes(status))
        throw new CareError(400, "Choose a valid administration status.");
      const administration = await tx.medicationAdministration.create({
        data: {
          reference: ref("ADM"),
          patientId: encounter.patientId,
          orderId: order.id,
          administeredBy: actor.name,
          administeredByRole: actor.role,
          status,
          notes: optionalText(body.notes, "Administration notes", 2000)
        }
      });
      await audit(tx, actor, encounterId, "MEDICATION_ADMINISTERED", administration.reference);
      return { ok: true };
    }
    if (action === "orderLab") {
      requireRole(actor, ["doctor"]);
      active(encounter.status);
      if (!["ADMITTED", "IN_CARE"].includes(encounter.status))
        throw new CareError(409, "Admit the patient before ordering laboratory work.");
      const labOrder = await tx.careLabOrder.create({
        data: {
          reference: ref("LAB"),
          encounterId,
          testName: text(body.testName, "Test name", 200),
          specimen: text(body.specimen, "Specimen", 100),
          requestedById: actor.id
        }
      });
      await audit(tx, actor, encounterId, "LAB_REQUESTED");
      return { ok: true, labOrder };
    }
    if (["collectLab", "resultLab", "reviewLab", "cancelLab"].includes(action)) {
      requireRole(
        actor,
        action === "reviewLab" || action === "cancelLab" ? ["doctor"] : ["doctor", "nurse"]
      );
      active(encounter.status);
      const lab = await tx.careLabOrder.findFirst({
        where: { id: text(body.labOrderId, "Laboratory order", 100), encounterId }
      });
      if (!lab) throw new CareError(404, "Laboratory order not found.");
      const data: Prisma.CareLabOrderUpdateManyMutationInput = {};
      if (action === "collectLab") {
        if (lab.status !== "REQUESTED")
          throw new CareError(409, "This specimen is not awaiting collection.");
        data.status = "COLLECTED";
        data.collectedAt = new Date();
      }
      if (action === "resultLab") {
        if (lab.status !== "COLLECTED")
          throw new CareError(409, "Collect the specimen before recording its result.");
        const flag = text(body.abnormalFlag, "Result flag", 30);
        if (!["Normal", "Abnormal", "Critical"].includes(flag))
          throw new CareError(400, "Choose a valid result flag.");
        data.status = "RESULTED";
        data.reportedAt = new Date();
        data.resultSummary = text(body.resultSummary, "Result summary", 5000);
        data.abnormalFlag = flag;
      }
      if (action === "reviewLab") {
        if (lab.status !== "RESULTED")
          throw new CareError(409, "A reported result is required before clinical review.");
        data.status = "REVIEWED";
        data.reviewedAt = new Date();
        data.reviewedById = actor.id;
      }
      if (action === "cancelLab") {
        if (["REVIEWED", "CANCELLED"].includes(lab.status))
          throw new CareError(409, "This order is already final.");
        data.status = "CANCELLED";
      }
      const changed = await tx.careLabOrder.updateMany({
        where: { id: lab.id, status: lab.status },
        data
      });
      if (changed.count !== 1)
        throw new CareError(409, "The laboratory order changed. Refresh and try again.");
      await audit(tx, actor, encounterId, `LAB_${data.status}`);
      return { ok: true, labOrder: await tx.careLabOrder.findUnique({ where: { id: lab.id } }) };
    }
    throw new CareError(400, "Unknown journey action.");
  });
}
