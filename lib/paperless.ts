import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { type Actor, CareError, requireRole } from "@/lib/care-access";
import type { Prisma } from "@prisma/client";

export const categories: Record<string,{ creators:string[]; signers:string[]; readers:string[] }> = {
  ADMISSION: { creators:["admin"],signers:["patient"],readers:["patient","admin","doctor","nurse"] },
  PRIVACY: { creators:["admin"],signers:["patient"],readers:["patient","admin","doctor","nurse"] },
  TREATMENT: { creators:["doctor"],signers:["doctor","patient"],readers:["patient","doctor","nurse"] },
  PROCEDURE: { creators:["doctor"],signers:["doctor","patient"],readers:["patient","doctor","nurse"] },
  FINANCIAL: { creators:["admin","billing"],signers:["patient"],readers:["patient","admin","billing"] },
  REFERRAL: { creators:["doctor"],signers:["doctor"],readers:["patient","doctor","nurse"] },
  DISCHARGE: { creators:["doctor"],signers:["doctor"],readers:["patient","doctor","nurse"] },
  SUPPORTING: { creators:["patient","admin"],signers:[],readers:["patient","admin"] }
};
export const digest = (input: string | Buffer | Uint8Array) => createHash("sha256").update(input).digest("hex");
export const documentDigest = (d:{patientId:string;category:string;title:string;body:string;requiredRoles:string}, fileDigest="") => digest(JSON.stringify([d.patientId,d.category,d.title,d.body,d.requiredRoles,fileDigest]));
export function documentScope(actor:Actor):Prisma.PaperDocumentWhereInput {
  requireRole(actor,["patient","admin","doctor","nurse","billing"]);
  const allowed=Object.keys(categories).filter(k=>categories[k].readers.includes(actor.role));
  return {category:{in:allowed},...(actor.role==="patient"?{patient:{userId:actor.id}}:{})};
}
export async function getDocument(actor:Actor,id:string,tx:Prisma.TransactionClient=prisma) {
  const doc=await tx.paperDocument.findFirst({where:{id,...documentScope(actor)},include:{patient:{select:{fullName:true,facilityFileNumber:true,userId:true}},signatures:true,attachment:{select:{fileName:true,digest:true}}}});
  if(!doc)throw new CareError(404,"Document not found.");
  return doc;
}
export function checkOrigin(request:Request) {
  const origin=request.headers.get("origin");
  if(origin && origin!==new URL(request.url).origin && origin!==process.env.REMOTE_APP_ORIGIN)throw new CareError(403,"Origin not permitted.");
}
