import { requireAuthSession } from "@/lib/auth";
import { jsonObject, text } from "@/lib/care-access";
import {
  portalErrorResponse,
  getPortalDocuments,
  mutatePortalDocuments,
  portalJson
} from "@/lib/portal-communications";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { user } = await requireAuthSession();
    return portalJson(
      await getPortalDocuments(
        user,
        text(new URL(request.url).searchParams.get("encounterId"), "Encounter", 150)
      )
    );
  } catch (error) {
    return portalErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await requireAuthSession();
    return portalJson(await mutatePortalDocuments(user, jsonObject(await request.json())));
  } catch (error) {
    return portalErrorResponse(error);
  }
}
