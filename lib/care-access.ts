import { randomUUID } from "node:crypto";
import type { Prisma, Role, User } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export type Actor = Pick<User, "id" | "name" | "email" | "role" | "unit"> & {
  organization?: string;
};

export class CareError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "CareError";
  }
}

export function requireRole(actor: Actor, roles: readonly Role[]) {
  if (!roles.includes(actor.role)) {
    throw new CareError(403, "Your role cannot perform this action.");
  }
}

export function encounterWhere(actor: Actor): Prisma.CareEncounterWhereInput {
  switch (actor.role) {
    case "admin":
    case "doctor":
    case "nurse":
    case "billing":
      return {};
    case "paramedic":
      return { crewUserId: actor.id };
    case "patient":
      return { patient: { userId: actor.id } };
    case "insurer":
      return actor.organization
        ? {
            patient: { consentDataSharing: true, popiaConsent: true },
            claims: { some: { scheme: actor.organization, sharedWithInsurer: true } }
          }
        : { id: "__inaccessible__" };
    default:
      return { id: "__inaccessible__" };
  }
}

type CareDatabase = Prisma.TransactionClient;

export async function requireEncounter(actor: Actor, id: string, tx: CareDatabase = prisma) {
  if (typeof id !== "string" || !id.trim()) {
    throw new CareError(400, "Select an encounter.");
  }
  const encounter = await tx.careEncounter.findFirst({
    where: { AND: [{ id }, encounterWhere(actor)] },
    include: { patient: true }
  });
  if (!encounter) throw new CareError(404, "Encounter not found.");
  return encounter;
}

export async function audit(
  tx: CareDatabase,
  actor: Actor,
  encounterId: string | null,
  action: string,
  details = ""
) {
  return tx.careAuditEvent.create({
    data: {
      encounterId,
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action,
      details: details.slice(0, 500)
    }
  });
}

export function ref(prefix: string) {
  return `${prefix}-${randomUUID().replaceAll("-", "").toUpperCase()}`;
}

export function text(value: unknown, label: string, max = 2000): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new CareError(400, `${label} is required.`);
  }
  const result = value.trim();
  if (result.length > max) throw new CareError(400, `${label} must be ${max} characters or fewer.`);
  return result;
}

export function optionalText(value: unknown, label: string, max = 2000): string {
  return value === undefined || value === null || value === "" ? "" : text(value, label, max);
}

export function moneyInteger(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 100_000_000
  ) {
    throw new CareError(400, `${label} must be a whole number of cents between 0 and 100000000.`);
  }
  return value;
}

export function errorResponse(error: unknown) {
  if (error && typeof error === "object" && "code" in error && error.code === "P2034") {
    return NextResponse.json(
      { ok: false, message: "This record changed. Refresh and try again." },
      { status: 409 }
    );
  }
  const status =
    error instanceof CareError
      ? error.status
      : error instanceof SyntaxError
        ? 400
        : error instanceof Error && error.message === "UNAUTHENTICATED"
          ? 401
          : error instanceof Error && error.message === "FORBIDDEN"
            ? 403
            : 500;
  const message =
    error instanceof CareError
      ? error.message
      : status === 401
        ? "Sign in to continue."
        : status === 403
          ? "Your role cannot perform this action."
          : status === 400
            ? "Send a valid JSON request."
            : "Unable to complete this request. Please retry.";
  return NextResponse.json(
    { ok: false, message },
    {
      status,
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie" }
    }
  );
}

export function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CareError(400, "Send a JSON object.");
  }
  return value as Record<string, unknown>;
}

export function versionNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new CareError(400, "A valid record version is required. Refresh and try again.");
  }
  return value;
}

export function masked(value: string) {
  return value ? `••••${value.slice(-4)}` : "Not provided";
}
