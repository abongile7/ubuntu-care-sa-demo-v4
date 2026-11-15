import { requireAuthSession } from "@/lib/auth";
import { portalErrorResponse, portalJson, uploadPortalFile } from "@/lib/portal-communications";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { user } = await requireAuthSession();
    return portalJson(await uploadPortalFile(user, request));
  } catch (error) {
    return portalErrorResponse(error);
  }
}
