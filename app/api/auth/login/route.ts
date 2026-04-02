import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createUserSession, verifyPassword } from "@/lib/auth";

export async function POST(request: Request) {
  const body = await request.json();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!email || !password) {
    return NextResponse.json(
      { ok: false, message: "Email and password are required." },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { email }
  });

  if (!user) {
    return NextResponse.json(
      { ok: false, message: "Invalid login credentials." },
      { status: 401 }
    );
  }

  const valid = await verifyPassword(password, user.passwordHash);

  if (!valid) {
    return NextResponse.json(
      { ok: false, message: "Invalid login credentials." },
      { status: 401 }
    );
  }

  await createUserSession({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    unit: user.unit
  });

  return NextResponse.json({ ok: true });
}
