import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const session = await requireAuthSession();

    if (session.user.role !== "admin" && session.user.role !== "doctor") {
      return NextResponse.json({ ok: false, message: "Only admin or doctors can book transfers." }, { status: 403 });
    }

    const body = await request.json();

    await prisma.transferRecord.create({
      data: {
        reference: `TRN-${Date.now()}`,
        patientId: String(body.patientId ?? ""),
        type: String(body.type ?? "Inter-hospital transfer"),
        sourceFacility: String(body.sourceFacility ?? ""),
        destinationFacility: String(body.destinationFacility ?? ""),
        transportMode: String(body.transportMode ?? "Ambulance"),
        escortType: String(body.escortType ?? ""),
        reason: String(body.reason ?? ""),
        requestedBy: session.user.name,
        status: "Booked",
        eta: String(body.eta ?? "")
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save transfer.";
    const status = message === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ ok: false, message: status === 401 ? "Sign in to continue." : message }, { status });
  }
}
