import { requireAuthSession } from "@/lib/auth";
import { portalErrorResponse, downloadPortalFile } from "@/lib/portal-communications";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ fileId: string }> }) {
  try {
    const { user } = await requireAuthSession();
    return await downloadPortalFile(user, (await context.params).fileId);
  } catch (error) {
    return portalErrorResponse(error);
  }
}
