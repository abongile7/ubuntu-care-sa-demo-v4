import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { medicationRoutes } from "@/lib/demo-data";

export async function POST(request: Request) {
  try {
    const session = await requireAuthSession();
    const body = await request.json();
    const action = String(body.action ?? "prescribe");

    if (action === "prescribe") {
      if (session.user.role !== "doctor") {
        return NextResponse.json({ ok: false, message: "Only doctors can prescribe medication." }, { status: 403 });
      }

      const patientId = typeof body.patientId === "string" ? body.patientId.trim() : "";
      const drugName = typeof body.drugName === "string" ? body.drugName.trim() : "";
      const dose = typeof body.dose === "string" ? body.dose.trim() : "";
      const frequency = typeof body.frequency === "string" ? body.frequency.trim() : "";
      const route = String(body.route ?? "Oral");
      const startDate = new Date(String(body.startDate ?? new Date().toISOString().slice(0, 10)));
      const endDate = body.endDate ? new Date(String(body.endDate)) : null;

      if (!patientId || !drugName || !dose || !frequency) {
        return NextResponse.json({ ok: false, message: "Patient, medication, dose, and frequency are required." }, { status: 400 });
      }
      if (!medicationRoutes.some((item) => item === route) || Number.isNaN(startDate.getTime()) || (endDate && (Number.isNaN(endDate.getTime()) || endDate < startDate))) {
        return NextResponse.json({ ok: false, message: "Choose a valid medication route and date range." }, { status: 400 });
      }
      if (!(await prisma.patientProfile.findUnique({ where: { id: patientId } }))) {
        return NextResponse.json({ ok: false, message: "Patient record not found." }, { status: 404 });
      }

      await prisma.medicationOrder.create({
        data: {
          reference: `MED-${Date.now()}`,
          patientId,
          prescribedBy: session.user.name,
          prescribedByRole: session.user.role,
          drugName,
          dose,
          route,
          frequency,
          indication: String(body.indication ?? ""),
          startDate,
          endDate,
          status: "Active"
        }
      });

      return NextResponse.json({ ok: true });
    }

    if (action === "administer") {
      if (session.user.role !== "nurse" && session.user.role !== "doctor") {
        return NextResponse.json({ ok: false, message: "Only clinical staff can chart administration." }, { status: 403 });
      }

      const patientId = typeof body.patientId === "string" ? body.patientId.trim() : "";
      const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
      const status = String(body.status ?? "Given");
      if (!patientId || !orderId) {
        return NextResponse.json({ ok: false, message: "Patient and medication order are required." }, { status: 400 });
      }
      if (!["Given", "Withheld", "Missed"].includes(status)) {
        return NextResponse.json({ ok: false, message: "Choose a valid administration status." }, { status: 400 });
      }
      const order = await prisma.medicationOrder.findUnique({ where: { id: orderId } });

      if (!order) {
        return NextResponse.json({ ok: false, message: "Medication order not found." }, { status: 404 });
      }
      if (order.patientId !== patientId) {
        return NextResponse.json({ ok: false, message: "Medication order does not belong to the selected patient." }, { status: 400 });
      }
      if (order.status !== "Active") {
        return NextResponse.json({ ok: false, message: "Only active medication orders can be administered." }, { status: 409 });
      }

      await prisma.medicationAdministration.create({
        data: {
          reference: `ADM-${Date.now()}`,
          orderId: order.id,
          patientId: order.patientId,
          administeredBy: session.user.name,
          administeredByRole: session.user.role,
          status,
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
