import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const session = await requireAuthSession();

    if (session.user.role === "patient" || session.user.role === "admin") {
      return NextResponse.json(
        { ok: false, message: "Only clinical staff can record vital signs." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const patientId = String(body.patientId ?? "");

    if (!patientId) {
      return NextResponse.json({ ok: false, message: "Patient is required." }, { status: 400 });
    }

    await prisma.vitalRecord.create({
      data: {
        reference: `VTL-${Date.now()}`,
        patientId,
        recordedBy: session.user.name,
        recordedByRole: session.user.role,
        recordedAt: new Date(),
        systolic: Number(body.systolic ?? 0),
        diastolic: Number(body.diastolic ?? 0),
        pulse: Number(body.pulse ?? 0),
        temperature: Number(body.temperature ?? 0),
        respiratoryRate: Number(body.respiratoryRate ?? 0),
        spo2: Number(body.spo2 ?? 0),
        glucose: String(body.glucose ?? ""),
        painScore: Number(body.painScore ?? 0),
        notes: String(body.notes ?? "")
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save vitals.";
    const status = message === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ ok: false, message: status === 401 ? "Sign in to continue." : message }, { status });
  }
}
