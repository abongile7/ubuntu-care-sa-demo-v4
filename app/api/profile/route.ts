import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { serializePatient } from "@/lib/serializers";

// Self-reported details can be updated by the patient. File identifiers,
// verified blood type, referral details, triage, and bed allocation belong to staff.
const patientEditableFields = new Set([
  "fullName", "saId", "passportNumber", "citizenship", "dateOfBirth", "gender",
  "phone", "email", "language", "preferredContactMethod", "province", "city",
  "address", "postalCode", "maritalStatus", "occupation", "employer", "employerPhone",
  "religion", "homeClinic", "arrivalReason", "medicalAidScheme", "medicalAidPlan",
  "medicalAidNumber", "membershipTier", "principalMemberName", "principalMemberNumber",
  "relationshipToPrincipalMember", "nextOfKin", "nextOfKinRelation", "nextOfKinPhone",
  "guardianName", "guardianPhone", "allergies", "currentMedication", "chronicConditions",
  "disabilitySupport", "pregnancyStatus", "interpreterRequired", "popiaConsent",
  "consentTreatment", "consentDataSharing", "consentBilling"
]);

function boolValue(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  return fallback;
}

export async function PUT(request: Request) {
  try {
    const session = await requireAuthSession();

    if (session.user.role !== "patient" && session.user.role !== "admin") {
      return NextResponse.json(
        { ok: false, message: "This role cannot edit patient onboarding details." },
        { status: 403 }
      );
    }

    const body = await request.json();

    const patient =
      session.user.role === "patient"
        ? await prisma.patientProfile.findUnique({
            where: { userId: session.user.id }
          })
        : await prisma.patientProfile.findUnique({
            where: { id: String(body.id ?? "") }
          });

    if (!patient) {
      return NextResponse.json(
        { ok: false, message: "Patient profile not found." },
        { status: 404 }
      );
    }

    const data: Prisma.PatientProfileUpdateInput = {
        facilityFileNumber: String(body.facilityFileNumber ?? patient.facilityFileNumber),
        fullName: String(body.fullName ?? patient.fullName),
        saId: String(body.saId ?? patient.saId),
        passportNumber: String(body.passportNumber ?? patient.passportNumber),
        citizenship: String(body.citizenship ?? patient.citizenship),
        dateOfBirth: new Date(String(body.dateOfBirth ?? patient.dateOfBirth.toISOString())),
        gender: String(body.gender ?? patient.gender),
        phone: String(body.phone ?? patient.phone),
        email: String(body.email ?? patient.email),
        language: String(body.language ?? patient.language),
        preferredContactMethod: String(body.preferredContactMethod ?? patient.preferredContactMethod),
        province: String(body.province ?? patient.province),
        city: String(body.city ?? patient.city),
        address: String(body.address ?? patient.address),
        postalCode: String(body.postalCode ?? patient.postalCode),
        maritalStatus: String(body.maritalStatus ?? patient.maritalStatus),
        occupation: String(body.occupation ?? patient.occupation),
        employer: String(body.employer ?? patient.employer),
        employerPhone: String(body.employerPhone ?? patient.employerPhone),
        religion: String(body.religion ?? patient.religion),
        homeClinic: String(body.homeClinic ?? patient.homeClinic),
        arrivalMode: String(body.arrivalMode ?? patient.arrivalMode),
        arrivalReason: String(body.arrivalReason ?? patient.arrivalReason),
        broughtBy: String(body.broughtBy ?? patient.broughtBy),
        referralSource: String(body.referralSource ?? patient.referralSource),
        referringDoctor: String(body.referringDoctor ?? patient.referringDoctor),
        transferredFrom: String(body.transferredFrom ?? patient.transferredFrom),
        transferReason: String(body.transferReason ?? patient.transferReason),
        medicalAidScheme: String(body.medicalAidScheme ?? patient.medicalAidScheme),
        medicalAidPlan: String(body.medicalAidPlan ?? patient.medicalAidPlan),
        medicalAidNumber: String(body.medicalAidNumber ?? patient.medicalAidNumber),
        membershipTier: String(body.membershipTier ?? patient.membershipTier),
        principalMemberName: String(body.principalMemberName ?? patient.principalMemberName),
        principalMemberNumber: String(body.principalMemberNumber ?? patient.principalMemberNumber),
        relationshipToPrincipalMember: String(
          body.relationshipToPrincipalMember ?? patient.relationshipToPrincipalMember
        ),
        nextOfKin: String(body.nextOfKin ?? patient.nextOfKin),
        nextOfKinRelation: String(body.nextOfKinRelation ?? patient.nextOfKinRelation),
        nextOfKinPhone: String(body.nextOfKinPhone ?? patient.nextOfKinPhone),
        guardianName: String(body.guardianName ?? patient.guardianName),
        guardianPhone: String(body.guardianPhone ?? patient.guardianPhone),
        bloodType: String(body.bloodType ?? patient.bloodType),
        allergies: String(body.allergies ?? patient.allergies),
        currentMedication: String(body.currentMedication ?? patient.currentMedication),
        chronicConditions: String(body.chronicConditions ?? patient.chronicConditions),
        disabilitySupport: String(body.disabilitySupport ?? patient.disabilitySupport),
        pregnancyStatus: String(body.pregnancyStatus ?? patient.pregnancyStatus),
        visitPathway: String(body.visitPathway ?? patient.visitPathway),
        triagePriority: String(body.triagePriority ?? patient.triagePriority),
        ward: String(body.ward ?? patient.ward),
        bedNumber: String(body.bedNumber ?? patient.bedNumber),
        interpreterRequired: boolValue(body.interpreterRequired, patient.interpreterRequired),
        popiaConsent: boolValue(body.popiaConsent, patient.popiaConsent),
        consentTreatment: boolValue(body.consentTreatment, patient.consentTreatment),
        consentDataSharing: boolValue(body.consentDataSharing, patient.consentDataSharing),
        consentBilling: boolValue(body.consentBilling, patient.consentBilling)
    };

    // The UI submits the full profile. Ignore protected fields for patients
    // instead of rejecting otherwise valid contact-detail saves.
    const permittedData = session.user.role === "patient"
      ? Object.fromEntries(Object.entries(data).filter(([field]) => patientEditableFields.has(field)))
      : data;

    const updated = await prisma.patientProfile.update({
      where: { id: patient.id },
      data: permittedData
    });

    return NextResponse.json({ ok: true, patient: serializePatient(updated) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save patient profile.";
    const status = message === "UNAUTHENTICATED" ? 401 : 500;

    return NextResponse.json(
      { ok: false, message: status === 401 ? "Sign in to continue." : message },
      { status }
    );
  }
}
