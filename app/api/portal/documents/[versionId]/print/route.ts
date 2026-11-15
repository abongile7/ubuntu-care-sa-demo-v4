import { requireAuthSession } from "@/lib/auth";
import { portalErrorResponse, printPortalDocument } from "@/lib/portal-communications";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ versionId: string }> }) {
  try {
    const { user } = await requireAuthSession();
    return await printPortalDocument(user, (await context.params).versionId);
  } catch (error) {
    return portalErrorResponse(error);
  }
}
