import { requireAuthSession } from "@/lib/auth";
import { jsonObject } from "@/lib/care-access";
import {
  portalErrorResponse,
  getPortalMessages,
  mutatePortalMessages,
  portalJson
} from "@/lib/portal-communications";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { user } = await requireAuthSession();
    return portalJson(await getPortalMessages(user, new URL(request.url).searchParams));
  } catch (error) {
    return portalErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await requireAuthSession();
    return portalJson(await mutatePortalMessages(user, jsonObject(await request.json())));
  } catch (error) {
    return portalErrorResponse(error);
  }
}
