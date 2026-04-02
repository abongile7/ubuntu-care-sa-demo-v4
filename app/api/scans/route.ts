import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const session = await requireAuthSession();

    if (session.user.role === "patient") {
      return NextResponse.json(
        { ok: false, message: "Only staff roles can upload MRI or imaging files." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const patientId = String(body.patientId ?? "");
    const title = String(body.title ?? "").trim();
    const modality = String(body.modality ?? "MRI");
    const previewData = String(body.previewData ?? "");
    const notes = String(body.notes ?? "");
    const department = String(body.department ?? "Radiology");

    if (!patientId || !title || !previewData) {
      return NextResponse.json(
        { ok: false, message: "Patient, title, and preview file are required." },
        { status: 400 }
      );
    }

    const patient = await prisma.patientProfile.findUnique({
      where: { id: patientId }
    });

    if (!patient) {
      return NextResponse.json(
        { ok: false, message: "Patient record not found." },
        { status: 404 }
      );
    }

    await prisma.scanRecord.create({
      data: {
        reference: `SCAN-${Date.now()}`,
        patientId,
        title,
        modality,
        takenAt: new Date(),
        department,
        uploadedBy: session.user.name,
        uploadedByRole: session.user.role,
        notes,
        previewData
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to upload scan.";
    const status = message === "UNAUTHENTICATED" ? 401 : 500;

    return NextResponse.json(
      { ok: false, message: status === 401 ? "Sign in to continue." : message },
      { status }
    );
  }
}
