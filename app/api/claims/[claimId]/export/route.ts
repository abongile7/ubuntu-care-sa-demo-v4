import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { errorResponse } from "@/lib/care-access";
import { exportClaim } from "@/lib/care-integrations";
export async function GET(_request: Request, context: { params: Promise<{ claimId: string }> }) {
  try {
    const { user } = await requireAuthSession();
    const { claimId } = await context.params;
    return NextResponse.json(await exportClaim(user, claimId), {
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
        "Content-Disposition": 'attachment; filename="simulated-claim.json"'
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
