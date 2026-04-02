import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const session = await requireAuthSession();

    if (session.user.role === "patient") {
      return NextResponse.json({ ok: false, message: "Only staff can send case documents." }, { status: 403 });
    }

    const body = await request.json();

    await prisma.emailLog.create({
      data: {
        reference: `EML-${Date.now()}`,
        patientId: String(body.patientId ?? ""),
        recipient: String(body.recipient ?? ""),
        subject: String(body.subject ?? ""),
        category: String(body.category ?? "Document"),
        sentBy: session.user.name,
        status: "Queued"
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to queue email.";
    const status = message === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ ok: false, message: status === 401 ? "Sign in to continue." : message }, { status });
  }
}
