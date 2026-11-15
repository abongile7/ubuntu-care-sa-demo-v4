import { NextResponse } from "next/server";
import { requireLegacySession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const session = await requireLegacySession();

    if (session.user.role === "patient") {
      return NextResponse.json({ ok: false, message: "Only staff can create hospital documents." }, { status: 403 });
    }

    const body = await request.json();

    await prisma.documentRecord.create({
      data: {
        reference: `DOC-${Date.now()}`,
        patientId: String(body.patientId ?? ""),
        category: String(body.category ?? "Admission pack"),
        title: String(body.title ?? ""),
        body: String(body.body ?? ""),
        authorName: session.user.name,
        authorRole: session.user.role
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create document.";
    const status = message === "UNAUTHENTICATED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ ok: false, message: status === 401 ? "Sign in to continue." : status === 403 ? "This role cannot access the detailed hospital workspace." : message }, { status });
  }
}
