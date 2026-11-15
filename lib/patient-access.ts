import type { Prisma, User } from "@prisma/client";

// Patient access must be enforced in the query, even when the caller supplies
// an ID obtained outside the patient portal. Staff retain their case access.
export function patientAccessWhere(
  user: Pick<User, "id" | "role">,
  patientId?: string
): Prisma.PatientProfileWhereInput {
  return {
    ...(patientId !== undefined ? { id: patientId } : {}),
    ...(user.role === "patient" ? { userId: user.id } : {})
  };
}
