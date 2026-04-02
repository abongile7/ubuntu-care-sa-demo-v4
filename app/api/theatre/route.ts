import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const session = await requireAuthSession();

    if (session.user.role !== "doctor" && session.user.role !== "admin") {
      return NextResponse.json({ ok: false, message: "Only doctors and admin can manage theatre cases." }, { status: 403 });
    }

    const body = await request.json();

    await prisma.theatreCase.create({
      data: {
        reference: `THR-${Date.now()}`,
        patientId: String(body.patientId ?? ""),
        procedureName: String(body.procedureName ?? ""),
        specialty: String(body.specialty ?? ""),
        surgeon: String(body.surgeon ?? session.user.name),
        anaesthetist: String(body.anaesthetist ?? ""),
        theatreRoom: String(body.theatreRoom ?? "Theatre 1"),
        scheduledAt: new Date(String(body.scheduledAt ?? new Date().toISOString())),
        urgency: String(body.urgency ?? "Elective"),
        status: "Booked",
        notes: String(body.notes ?? "")
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create theatre case.";
    const status = message === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ ok: false, message: status === 401 ? "Sign in to continue." : message }, { status });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireAuthSession();

    if (session.user.role !== "doctor" && session.user.role !== "admin") {
      return NextResponse.json({ ok: false, message: "Only doctors and admin can update theatre cases." }, { status: 403 });
    }

    const body = await request.json();
    await prisma.theatreCase.update({
      where: { id: String(body.caseId ?? "") },
      data: { status: String(body.status ?? "Booked") }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update theatre case.";
    const status = message === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ ok: false, message: status === 401 ? "Sign in to continue." : message }, { status });
  }
}
