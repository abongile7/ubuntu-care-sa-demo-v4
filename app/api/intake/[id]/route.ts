import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuthSession } from "@/lib/auth";
import { audit, CareError, errorResponse } from "@/lib/care-access";
import { digest } from "@/lib/paperless";
import { scope } from "@/lib/intake-access";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 try{
 const {user}=await requireAuthSession(),{id}=await params;
 const row=await prisma.arrivalIntake.findFirst({where:{id,...scope(user)},include:{attachment:true}});
 if(!row?.attachment)throw new CareError(404,"Referral PDF not found.");
 if(digest(row.attachment.bytes)!==row.attachment.digest)throw new CareError(409,"Referral integrity check failed.");
 await audit(prisma,user,null,"INTAKE_REFERRAL_DOWNLOADED",id);
 return new NextResponse(new Uint8Array(row.attachment.bytes),{headers:{"Content-Type":"application/pdf","Content-Disposition":'attachment; filename="synthetic-referral.pdf"',"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
 }catch(e){return errorResponse(e);}
}
