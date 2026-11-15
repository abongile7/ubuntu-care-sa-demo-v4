import { NextResponse } from "next/server";
import { requireLegacySession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { patientAccessWhere } from "@/lib/patient-access";

function toDateTimeValue(value: string) {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function POST(request: Request) {
  try {
    const session = await requireLegacySession();

    if (session.user.role !== "patient" && session.user.role !== "admin") {
      return NextResponse.json(
        { ok: false, message: "This role cannot book appointments." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const patientId = String(body.patientId ?? "");
    const scheduledAt = toDateTimeValue(String(body.scheduledAt ?? ""));

    if (!patientId || !scheduledAt) {
      return NextResponse.json(
        { ok: false, message: "Patient and appointment date are required." },
        { status: 400 }
      );
    }

    const patient = await prisma.patientProfile.findFirst({
      where: patientAccessWhere(session.user, patientId)
    });

    if (!patient) {
      return NextResponse.json(
        { ok: false, message: "Patient record not found." },
        { status: 404 }
      );
    }

    await prisma.appointment.create({
      data: {
        reference: `APT-${Date.now()}`,
        patientId,
        department: String(body.department ?? "Admissions"),
        clinician: String(body.clinician ?? "TBD"),
        scheduledAt,
        type: String(body.type ?? "General consultation"),
        status: "Requested",
        location: String(body.location ?? "Main campus"),
        notes: String(body.notes ?? ""),
        createdByRole: session.user.role
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create appointment.";
    const status = message === "UNAUTHENTICATED" ? 401 : message === "FORBIDDEN" ? 403 : 500;

    return NextResponse.json(
      { ok: false, message: status === 401 ? "Sign in to continue." : status === 403 ? "This role cannot access the detailed hospital workspace." : message },
      { status }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireLegacySession();

    if (session.user.role === "patient") {
      return NextResponse.json(
        { ok: false, message: "Only staff roles can update appointment statuses." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const appointmentId = String(body.appointmentId ?? "");
    const statusText = String(body.status ?? "");

    if (!appointmentId || !statusText) {
      return NextResponse.json(
        { ok: false, message: "Appointment and status are required." },
        { status: 400 }
      );
    }

    await prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: statusText
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update appointment.";
    const status = message === "UNAUTHENTICATED" ? 401 : message === "FORBIDDEN" ? 403 : 500;

    return NextResponse.json(
      { ok: false, message: status === 401 ? "Sign in to continue." : status === 403 ? "This role cannot access the detailed hospital workspace." : message },
      { status }
    );
  }
}
