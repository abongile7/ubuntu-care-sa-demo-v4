import { CareError, type Actor } from "@/lib/care-access";
import type { Prisma } from "@prisma/client";
export function scope(actor:Actor):Prisma.ArrivalIntakeWhereInput{
 if(actor.role==="admin"||actor.role==="nurse")return {};
 if(actor.role==="doctor")return {assignedDoctorId:actor.id};
 if(actor.role==="paramedic")return {createdById:actor.id};
 throw new CareError(403,"This role cannot access intake.");
}
