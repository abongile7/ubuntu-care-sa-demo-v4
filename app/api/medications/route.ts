import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const session = await requireAuthSession();
    const body = await request.json();
    const action = String(body.action ?? "prescribe");

    if (action === "prescribe") {
      if (session.user.role !== "doctor") {
        return NextResponse.json({ ok: false, message: "Only doctors can prescribe medication." }, { status: 403 });
      }

      await prisma.medicationOrder.create({
        data: {
          reference: `MED-${Date.now()}`,
          patientId: String(body.patientId ?? ""),
          prescribedBy: session.user.name,
          prescribedByRole: session.user.role,
          drugName: String(body.drugName ?? ""),
          dose: String(body.dose ?? ""),
          route: String(body.route ?? "Oral"),
          frequency: String(body.frequency ?? ""),
          indication: String(body.indication ?? ""),
          startDate: new Date(String(body.startDate ?? new Date().toISOString().slice(0, 10))),
          endDate: body.endDate ? new Date(String(body.endDate)) : null,
          status: "Active"
        }
      });

      return NextResponse.json({ ok: true });
    }

    if (action === "administer") {
      if (session.user.role !== "nurse" && session.user.role !== "doctor") {
        return NextResponse.json({ ok: false, message: "Only clinical staff can chart administration." }, { status: 403 });
      }

      const orderId = String(body.orderId ?? "");
      const order = await prisma.medicationOrder.findUnique({ where: { id: orderId } });

      if (!order) {
        return NextResponse.json({ ok: false, message: "Medication order not found." }, { status: 404 });
      }

      await prisma.medicationAdministration.create({
        data: {
          reference: `ADM-${Date.now()}`,
          orderId: order.id,
          patientId: order.patientId,
          administeredBy: session.user.name,
          administeredByRole: session.user.role,
          status: String(body.status ?? "Given"),
          notes: String(body.notes ?? "")
        }
      });

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, message: "Invalid medication action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save medication workflow.";
    const status = message === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ ok: false, message: status === 401 ? "Sign in to continue." : message }, { status });
  }
}
