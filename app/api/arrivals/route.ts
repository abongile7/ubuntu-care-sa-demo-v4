import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const session = await requireAuthSession();

    if (session.user.role !== "admin" && session.user.role !== "nurse") {
      return NextResponse.json({ ok: false, message: "Only admin or nursing staff can register arrivals." }, { status: 403 });
    }

    const body = await request.json();
    const patientId = String(body.patientId ?? "");

    const patient = patientId
      ? await prisma.patientProfile.findUnique({ where: { id: patientId } })
      : null;

    await prisma.arrivalRecord.create({
      data: {
        reference: `ARR-${Date.now()}`,
        patientId,
        patientName: String(body.patientName ?? patient?.fullName ?? ""),
        arrivalMode: String(body.arrivalMode ?? "Walk-in"),
        source: String(body.source ?? "Self referral"),
        triageColor: String(body.triageColor ?? "Green"),
        casualtyArea: String(body.casualtyArea ?? "Casualty"),
        handoverNotes: String(body.handoverNotes ?? ""),
        broughtInAt: new Date(),
        status: String(body.status ?? "Awaiting review"),
        createdBy: session.user.name
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to register arrival.";
    const status = message === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ ok: false, message: status === 401 ? "Sign in to continue." : message }, { status });
  }
}
