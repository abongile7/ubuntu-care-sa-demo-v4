import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { errorResponse } from "@/lib/care-access";
import { portalSnapshot } from "@/lib/portal-workflows";
export async function GET(request: Request) {
  try {
    const { user } = await requireAuthSession();
    return NextResponse.json(
      await portalSnapshot(user, new URL(request.url).searchParams.get("encounterId")),
      { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
