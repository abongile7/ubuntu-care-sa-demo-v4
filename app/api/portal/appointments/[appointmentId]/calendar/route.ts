import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { errorResponse } from "@/lib/care-access";
import { appointmentCalendar, schedulingHeaders } from "@/lib/portal-scheduling";

export const runtime = "nodejs";
export async function GET(
  _request: Request,
  context: { params: Promise<{ appointmentId: string }> }
) {
  try {
    const { user } = await requireAuthSession();
    const { appointmentId } = await context.params;
    return new NextResponse(await appointmentCalendar(user, appointmentId), {
      headers: {
        ...schedulingHeaders,
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": "attachment; filename=hospital-appointment.ics",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
