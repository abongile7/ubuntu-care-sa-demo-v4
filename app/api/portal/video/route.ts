import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { CareError, errorResponse, jsonObject, text } from "@/lib/care-access";
import { getVideoSignals, mutateVideo, schedulingHeaders } from "@/lib/portal-scheduling";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuthSession();
    return NextResponse.json(
      {
        ok: true,
        ...(await getVideoSignals(
          user,
          text(request.nextUrl.searchParams.get("roomId"), "Video room", 100)
        ))
      },
      { headers: schedulingHeaders }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuthSession();
    if (Number(request.headers.get("content-length")) > 110_000)
      throw new CareError(413, "Signal request is too large.");
    const body = await request.text();
    if (body.length > 110_000) throw new CareError(413, "Signal request is too large.");
    return NextResponse.json(
      { ok: true, ...(await mutateVideo(user, jsonObject(JSON.parse(body)))) },
      { headers: schedulingHeaders }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
