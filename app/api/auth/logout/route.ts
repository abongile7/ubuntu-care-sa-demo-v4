import { NextResponse } from "next/server";
import { clearAuthSession, getAuthSession } from "@/lib/auth";

export async function POST() {
  const session = await getAuthSession();
  await clearAuthSession(session?.token ?? null);

  return NextResponse.json({ ok: true });
}
