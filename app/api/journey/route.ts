import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { errorResponse, jsonObject } from "@/lib/care-access";
import { journeyAction, journeyDashboard } from "@/lib/care-workflow";

export async function GET(request: Request) {
  try {
    const { user } = await requireAuthSession();
    const result = await journeyDashboard(
      user,
      new URL(request.url).searchParams.get("encounterId")
    );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie" }
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await requireAuthSession();
    return NextResponse.json(await journeyAction(user, jsonObject(await request.json())));
  } catch (error) {
    return errorResponse(error);
  }
}
