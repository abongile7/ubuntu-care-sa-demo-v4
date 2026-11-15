import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { errorResponse, jsonObject } from "@/lib/care-access";
import { claimAction } from "@/lib/care-integrations";
export async function POST(request: Request) {
  try {
    const { user } = await requireAuthSession();
    return NextResponse.json(await claimAction(user, jsonObject(await request.json())));
  } catch (error) {
    return errorResponse(error);
  }
}
