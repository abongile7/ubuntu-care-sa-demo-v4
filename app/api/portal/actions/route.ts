import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { errorResponse, jsonObject } from "@/lib/care-access";
import { portalAction } from "@/lib/portal-workflows";
export async function POST(request: Request) {
  try {
    const { user } = await requireAuthSession();
    return NextResponse.json(await portalAction(user, jsonObject(await request.json())), {
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie" }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
