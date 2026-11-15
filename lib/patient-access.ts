import type { Prisma, User } from "@prisma/client";

// Patient access must be enforced in the query, even when the caller supplies
// an ID obtained outside the patient portal. Only the original clinical and
// administrative roles retain their detailed hospital case access.
export function patientAccessWhere(
  user: Pick<User, "id" | "role">,
  patientId?: string
): Prisma.PatientProfileWhereInput {
  if (user.role !== "patient" && !["doctor", "nurse", "admin"].includes(user.role)) {
    return { id: { in: [] } };
  }

  return {
    ...(patientId !== undefined ? { id: patientId } : {}),
    ...(user.role === "patient" ? { userId: user.id } : {})
  };
}
