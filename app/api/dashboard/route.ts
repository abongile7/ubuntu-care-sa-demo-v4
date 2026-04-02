import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { hospitalMeta, staffDirectory } from "@/lib/demo-data";
import { prisma } from "@/lib/prisma";
import {
  serializeAppointment,
  serializeArrival,
  serializeDocument,
  serializeEmailLog,
  serializeLabResult,
  serializeMedication,
  serializeMedicationAdministration,
  serializeMessage,
  serializePatient,
  serializeScan,
  serializeTask,
  serializeTheatreCase,
  serializeTransfer,
  serializeVital
} from "@/lib/serializers";

function buildCompletenessScore(patient: {
  saId: string;
  phone: string;
  email: string;
  medicalAidScheme: string;
  medicalAidNumber: string;
  nextOfKin: string;
  nextOfKinPhone: string;
  popiaConsent: boolean;
  consentTreatment: boolean;
  consentDataSharing: boolean;
  consentBilling: boolean;
  arrivalReason: string;
  ward: string;
}) {
  const checks = [
    Boolean(patient.saId),
    Boolean(patient.phone),
    Boolean(patient.email),
    Boolean(patient.medicalAidScheme),
    Boolean(patient.medicalAidNumber),
    Boolean(patient.nextOfKin),
    Boolean(patient.nextOfKinPhone),
    Boolean(patient.arrivalReason),
    Boolean(patient.ward),
    patient.popiaConsent,
    patient.consentTreatment,
    patient.consentDataSharing,
    patient.consentBilling
  ];

  const completed = checks.filter(Boolean).length;
  return Math.round((completed / checks.length) * 100);
}

function average<T>(items: T[], getValue: (item: T) => number) {
  if (!items.length) return 0;
  return Math.round(items.reduce((sum, item) => sum + getValue(item), 0) / items.length);
}

export async function GET(request: Request) {
  try {
    const session = await requireAuthSession();
    const url = new URL(request.url);
    const requestedPatientId = url.searchParams.get("patientId");

    const cases =
      session.user.role === "patient"
        ? await prisma.patientProfile.findMany({
            where: { userId: session.user.id },
            orderBy: { updatedAt: "desc" }
          })
        : await prisma.patientProfile.findMany({
            orderBy: { updatedAt: "desc" }
          });

    const activePatient =
      session.user.role === "patient"
        ? cases[0]
        : cases.find((item) => item.id === requestedPatientId) ?? cases[0];

    if (!activePatient) {
      return NextResponse.json(
        { ok: false, message: "No patient record found." },
        { status: 404 }
      );
    }

    const [
      appointments,
      scans,
      messages,
      tasks,
      vitals,
      medications,
      administrations,
      labs,
      theatreCases,
      transfers,
      documents,
      emails,
      arrivals
    ] = await Promise.all([
      prisma.appointment.findMany({
        where: { patientId: activePatient.id },
        orderBy: { scheduledAt: "asc" }
      }),
      prisma.scanRecord.findMany({
        where: { patientId: activePatient.id },
        orderBy: { takenAt: "desc" }
      }),
      prisma.messageRecord.findMany({
        orderBy: { createdAt: "desc" }
      }),
      prisma.shiftTask.findMany({
        orderBy: { createdAt: "desc" }
      }),
      prisma.vitalRecord.findMany({
        where: { patientId: activePatient.id },
        orderBy: { recordedAt: "desc" }
      }),
      prisma.medicationOrder.findMany({
        where: { patientId: activePatient.id },
        orderBy: { prescribedAt: "desc" }
      }),
      prisma.medicationAdministration.findMany({
        where: { patientId: activePatient.id },
        orderBy: { administeredAt: "desc" }
      }),
      prisma.labResult.findMany({
        where: { patientId: activePatient.id },
        orderBy: { reportedAt: "desc" }
      }),
      prisma.theatreCase.findMany({
        where: { patientId: activePatient.id },
        orderBy: { scheduledAt: "asc" }
      }),
      prisma.transferRecord.findMany({
        where: { patientId: activePatient.id },
        orderBy: { createdAt: "desc" }
      }),
      prisma.documentRecord.findMany({
        where: { patientId: activePatient.id },
        orderBy: { createdAt: "desc" }
      }),
      prisma.emailLog.findMany({
        where: { patientId: activePatient.id },
        orderBy: { createdAt: "desc" }
      }),
      prisma.arrivalRecord.findMany({
        orderBy: { broughtInAt: "desc" }
      })
    ]);

    const completeness = buildCompletenessScore(activePatient);
    const nextAppointment = appointments.find((item) => item.status !== "Completed") ?? appointments[0];
    const latestArrival = arrivals.find((item) => item.patientId === activePatient.id);
    const activeMedicationCount = medications.filter((item) => item.status === "Active").length;
    const avgSystolic = average(vitals, (item) => item.systolic);
    const avgDiastolic = average(vitals, (item) => item.diastolic);
    const abnormalLabs = labs.filter((item) => item.abnormalFlag !== "Normal").length;

    const admissions = {
      status: completeness >= 85 ? "Ready for clinician review" : "Needs admin verification",
      pathway: activePatient.visitPathway,
      ward: activePatient.ward,
      bedNumber: activePatient.bedNumber,
      triage: activePatient.triagePriority,
      funding:
        activePatient.medicalAidScheme === "Self-pay / cash patient"
          ? "Self-pay"
          : `${activePatient.medicalAidScheme} · ${activePatient.membershipTier}`,
      arrival:
        latestArrival
          ? `${latestArrival.arrivalMode} · ${latestArrival.casualtyArea ?? ""}`
          : activePatient.arrivalMode,
      completeness
    };

    const facilityMetrics = {
      totalCases: cases.length,
      activeTasks: tasks.filter((item) => item.status !== "Done").length,
      transfersToday: arrivals.filter((item) => item.arrivalMode.toLowerCase().includes("transfer")).length,
      ambulanceArrivals: arrivals.filter((item) => item.arrivalMode === "Ambulance").length,
      theatreCasesToday: await prisma.theatreCase.count(),
      pendingEmails: await prisma.emailLog.count({
        where: { status: { in: ["Queued", "Draft"] } }
      })
    };

    return NextResponse.json({
      ok: true,
      session: session.user,
      hospitalMeta,
      staffDirectory,
      roleCapabilities: {
        patientCanEditProfile: session.user.role === "patient",
        canBookAppointments: session.user.role === "patient" || session.user.role === "admin",
        canManageClinical: session.user.role === "doctor",
        canRecordVitals: session.user.role === "nurse" || session.user.role === "doctor",
        canManageTransfers: session.user.role === "admin",
        canManageTheatre: session.user.role === "doctor" || session.user.role === "admin"
      },
      cases: cases.map((item) => ({
        id: item.id,
        fullName: item.fullName,
        facilityFileNumber: item.facilityFileNumber,
        province: item.province,
        visitPathway: item.visitPathway,
        medicalAidScheme: item.medicalAidScheme,
        triagePriority: item.triagePriority,
        ward: item.ward,
        updatedAt: item.updatedAt.toISOString()
      })),
      activePatient: serializePatient(activePatient),
      appointments: appointments.map(serializeAppointment),
      scans: scans.map(serializeScan),
      messages: messages.map(serializeMessage),
      tasks: tasks.map(serializeTask),
      vitals: vitals.map(serializeVital),
      medications: medications.map(serializeMedication),
      administrations: administrations.map(serializeMedicationAdministration),
      labs: labs.map(serializeLabResult),
      theatreCases: theatreCases.map(serializeTheatreCase),
      transfers: transfers.map(serializeTransfer),
      documents: documents.map(serializeDocument),
      emails: emails.map(serializeEmailLog),
      arrivals: arrivals.map(serializeArrival),
      admissions,
      insights: {
        avgBloodPressure: avgSystolic && avgDiastolic ? `${avgSystolic}/${avgDiastolic}` : "No vitals yet",
        activeMedicationCount,
        abnormalLabs,
        nextAppointment: nextAppointment
          ? `${nextAppointment.type} · ${nextAppointment.scheduledAt.toISOString().slice(0, 16).replace("T", " ")}`
          : "No appointment booked"
      },
      facilityMetrics
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load dashboard.";
    const status = message === "UNAUTHENTICATED" ? 401 : 500;

    return NextResponse.json(
      {
        ok: false,
        message: status === 401 ? "Sign in to continue." : message
      },
      { status }
    );
  }
}
