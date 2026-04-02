import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "@/lib/demo-data";

const SESSION_TTL_DAYS = 7;

export type AuthSession = {
  token: string;
  user: Pick<User, "id" | "name" | "email" | "role" | "unit">;
};

function sessionExpiryDate() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_TTL_DAYS);
  return expiresAt;
}

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export async function createUserSession(user: Pick<User, "id" | "name" | "email" | "role" | "unit">) {
  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const expiresAt = sessionExpiryDate();

  await prisma.session.create({
    data: {
      token,
      userId: user.id,
      expiresAt
    }
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/"
  });

  return { token, user };
}

export async function getAuthSession(): Promise<AuthSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true }
  });

  if (!session) {
    return null;
  }

  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { token } }).catch(() => null);
    return null;
  }

  return {
    token: session.token,
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      role: session.user.role,
      unit: session.user.unit
    }
  };
}

export async function clearAuthSession(token?: string | null) {
  const cookieStore = await cookies();
  const currentToken = token ?? cookieStore.get(SESSION_COOKIE)?.value;

  if (currentToken) {
    await prisma.session.deleteMany({
      where: { token: currentToken }
    });
  }

  cookieStore.delete(SESSION_COOKIE);
}

export async function requireAuthSession() {
  const session = await getAuthSession();
  if (!session) {
    throw new Error("UNAUTHENTICATED");
  }
  return session;
}
