import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { errorResponse, jsonObject, text } from "@/lib/care-access";
import { listAppointments, mutateAppointment, schedulingHeaders } from "@/lib/portal-scheduling";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuthSession();
    const encounterId = text(request.nextUrl.searchParams.get("encounterId"), "Encounter", 100);
    return NextResponse.json(
      { ok: true, ...(await listAppointments(user, encounterId)) },
      { headers: schedulingHeaders }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuthSession();
    return NextResponse.json(
      { ok: true, ...(await mutateAppointment(user, jsonObject(await request.json()))) },
      { headers: schedulingHeaders }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
