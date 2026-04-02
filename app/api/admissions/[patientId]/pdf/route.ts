import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { hospitalMeta } from "@/lib/demo-data";
import { buildAdmissionsPdf } from "@/lib/pdf";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  context: { params: Promise<{ patientId: string }> | { patientId: string } }
) {
  try {
    const session = await requireAuthSession();
    const params = await context.params;
    const patientId = params.patientId;

    const patient = await prisma.patientProfile.findUnique({
      where: { id: patientId }
    });

    if (!patient) {
      return NextResponse.json(
        { ok: false, message: "Patient record not found." },
        { status: 404 }
      );
    }

    const [appointments, scans] = await Promise.all([
      prisma.appointment.findMany({
        where: { patientId },
        orderBy: { scheduledAt: "asc" }
      }),
      prisma.scanRecord.findMany({
        where: { patientId },
        orderBy: { takenAt: "desc" }
      })
    ]);

    const pdf = await buildAdmissionsPdf({
      hospitalName: hospitalMeta.name,
      generatedBy: session.user.name,
      patient,
      appointments,
      scans
    });

    return new NextResponse(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${patient.fullName.replace(/\s+/g, "-").toLowerCase()}-admissions-summary.pdf"`
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to build admissions PDF.";
    const status = message === "UNAUTHENTICATED" ? 401 : 500;

    return NextResponse.json(
      { ok: false, message: status === 401 ? "Sign in to continue." : message },
      { status }
    );
  }
}
