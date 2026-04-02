import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const session = await requireAuthSession();

    if (session.user.role === "patient") {
      return NextResponse.json({ ok: false, message: "Only staff can upload lab results." }, { status: 403 });
    }

    const body = await request.json();

    await prisma.labResult.create({
      data: {
        reference: `LAB-${Date.now()}`,
        patientId: String(body.patientId ?? ""),
        provider: String(body.provider ?? "Ampath"),
        testName: String(body.testName ?? ""),
        specimen: String(body.specimen ?? "Blood"),
        collectedAt: new Date(String(body.collectedAt ?? new Date().toISOString())),
        reportedAt: new Date(String(body.reportedAt ?? new Date().toISOString())),
        resultSummary: String(body.resultSummary ?? ""),
        abnormalFlag: String(body.abnormalFlag ?? "Normal"),
        fileUrl: String(body.fileUrl ?? ""),
        uploadedBy: session.user.name,
        uploadedByRole: session.user.role
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save lab result.";
    const status = message === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ ok: false, message: status === 401 ? "Sign in to continue." : message }, { status });
  }
}
