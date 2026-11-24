import { NextResponse } from "next/server";
import { requireAuthSession, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { audit, CareError, errorResponse, jsonObject, moneyInteger, optionalText, requireRole, text } from "@/lib/care-access";
import { categories, checkOrigin, digest, documentDigest, documentScope, getDocument } from "@/lib/paperless";
const reply=(data:object)=>NextResponse.json(data,{headers:{"Cache-Control":"private, no-store",Vary:"Cookie"}});
export async function GET(){
  try {
    const {user}=await requireAuthSession();requireRole(user,["patient","admin","doctor","nurse","billing"]);
    const scope=user.role==="patient"?{userId:user.id}:{};
    const patients=await prisma.patientProfile.findMany({where:scope,select:{id:true,fullName:true,facilityFileNumber:true,medicalAidScheme:true},orderBy:{fullName:"asc"},take:200});
    const documents=await prisma.paperDocument.findMany({where:documentScope(user),include:{patient:{select:{fullName:true,facilityFileNumber:true}},signatures:true,attachment:{select:{fileName:true,digest:true}}},orderBy:{createdAt:"desc"},take:100});
    const admissions=["admin","patient"].includes(user.role)?await prisma.preAdmission.findMany({where:{patient:scope},include:{patient:{select:{fullName:true,facilityFileNumber:true}}},orderBy:{createdAt:"desc"},take:100}):[];
    const claims=["admin","billing"].includes(user.role)?await prisma.careClaim.findMany({where:{status:{in:["APPROVED","PAID"]}},select:{id:true,reference:true,status:true,scheme:true,totalCents:true,remittances:true,encounter:{select:{patient:{select:{fullName:true}}}}},orderBy:{updatedAt:"desc"},take:100}):[];
    return reply({patients,documents,admissions,claims,templates:Object.keys(categories).filter(k=>categories[k].creators.includes(user.role))});
  }catch(e){return errorResponse(e);}
}
export async function POST(request:Request){
  try{
    checkOrigin(request);
    const {user}=await requireAuthSession();requireRole(user,["patient","admin","doctor","nurse","billing"]);
    // Bound JSON payload before parsing; supporting documents max 2 MiB decoded.
    const raw=await request.text();if(raw.length>3_000_000)throw new CareError(413,"File too large.");
    const body=jsonObject(JSON.parse(raw));const action=text(body.action,"Action",40);
    if(action==="preAdmission"){
      requireRole(user,["patient"]);
      const date=new Date(text(body.plannedAt,"Planned date",40));
      if(!Number.isFinite(+date)||+date<Date.now()-60000||+date>Date.now()+180*86400000)throw new CareError(400,"Choose a future admission within 180 days.");
      const funding=text(body.funding,"Funding",30);
      if(!["MEDICAL_AID","SELF_PAY"].includes(funding))throw new CareError(400,"Choose funding.");
      const authorization=optionalText(body.authorization,"Authorisation",100);
      await prisma.$transaction(async tx=>{
        const patient=await tx.patientProfile.findUnique({where:{userId:user.id}});
        if(!patient?.popiaConsent)throw new CareError(403,"Record privacy consent in onboarding first.");
        if(await tx.preAdmission.count({where:{patientId:patient.id,status:{in:["SUBMITTED","NEEDS_INFORMATION","READY"]}}}))throw new CareError(409,"An open pre-admission already exists.");
        const admission=await tx.preAdmission.create({data:{patientId:patient.id,plannedAt:date,department:text(body.department,"Department",100),reason:text(body.reason,"Reason",500),funding,authorization}});
        await audit(tx,user,null,"PRE_ADMISSION_SUBMITTED",admission.id);
      });return reply({ok:true});
    }
    if(action==="reviewAdmission"||action==="cancelAdmission"){
      const id=text(body.id,"Pre-admission",100);
      await prisma.$transaction(async tx=>{
        const row=await tx.preAdmission.findFirst({where:{id,...(user.role==="patient"?{patient:{userId:user.id}}:{})}});
        if(!row)throw new CareError(404,"Pre-admission not found.");
        if(action==="reviewAdmission")requireRole(user,["admin"]);else requireRole(user,["admin","patient"]);
        if(!["SUBMITTED","NEEDS_INFORMATION","READY"].includes(row.status))throw new CareError(409,"Pre-admission is closed.");
        const status=action==="cancelAdmission"?"CANCELLED":text(body.status,"Decision",30);
        if(!["READY","NEEDS_INFORMATION","CANCELLED"].includes(status))throw new CareError(400,"Invalid decision.");
        const authorization=user.role==="admin"?optionalText(body.authorization,"Authorisation",100)||row.authorization:row.authorization;
        if(status==="READY"&&row.funding==="MEDICAL_AID"&&!authorization)throw new CareError(409,"Record a fictional authorisation reference first.");
        const changed=await tx.preAdmission.updateMany({where:{id,status:row.status,updatedAt:row.updatedAt},data:{status,authorization,reviewNote:status==="NEEDS_INFORMATION"?text(body.note,"Information required",500):optionalText(body.note,"Review note",500)}});
        if(changed.count!==1)throw new CareError(409,"Refresh and retry.");
        await audit(tx,user,null,"PRE_ADMISSION_"+status,id);
      });return reply({ok:true});
    }
    if(action==="issue"){
      const category=text(body.category,"Category",40), config=categories[category];
      if(!config||!config.creators.includes(user.role))throw new CareError(403,"Cannot issue this document type.");
      const title=text(body.title,"Title",160),content=text(body.body,"Document content",12000);
      let attachment:{fileName:string;bytes:Buffer;digest:string}|undefined;
      if(body.file!==undefined){
        if(category!=="SUPPORTING")throw new CareError(400,"Attachments are restricted to supporting documents.");
        const file=typeof body.file==="string"?body.file:"";
        if(!/^[A-Za-z0-9+/]+={0,2}$/.test(file))throw new CareError(400,"Invalid PDF.");
        const bytes=Buffer.from(file,"base64");
        if(bytes.length>2*1024*1024||bytes.subarray(0,5).toString()!=="%PDF-")throw new CareError(400,"Choose a PDF no larger than 2 MiB.");
        attachment={fileName:text(body.fileName,"Filename",120).replace(/[^a-zA-Z0-9._-]/g,"_"),bytes,digest:digest(bytes)};
      }
      await prisma.$transaction(async tx=>{
        const patient=await tx.patientProfile.findFirst({where:user.role==="patient"?{userId:user.id}:{id:text(body.patientId,"Patient",100)}});
        if(!patient)throw new CareError(404,"Patient not found.");
        const values={patientId:patient.id,category,title,body:content,requiredRoles:config.signers.join(",")};
        const doc=await tx.paperDocument.create({data:{...values,digest:documentDigest(values,attachment?.digest),status:config.signers.length?"ISSUED":"FILED",createdById:user.id,createdByName:user.name,...(attachment?{attachment:{create:attachment}}:{})}});
        await audit(tx,user,null,"DOCUMENT_ISSUED",doc.id);
      });return reply({ok:true});
    }
    if(action==="sign"||action==="void"){
      const id=text(body.id,"Document",100);
      if(action==="sign"){
        const password=typeof body.password==="string"?body.password:"";
        const account=await prisma.user.findUniqueOrThrow({where:{id:user.id}});
        if(password.length>128||!await verifyPassword(password,account.passwordHash))throw new CareError(403,"Password confirmation failed.");
        if(body.confirm!==true)throw new CareError(400,"Explicitly confirm your intent to sign.");
      }
      await prisma.$transaction(async tx=>{
        const doc=await getDocument(user,id,tx);
        if(action==="void"){
          if(doc.createdById!==user.id||doc.status==="VOID")throw new CareError(403,"Only the issuer can void an active document.");
          const changed=await tx.paperDocument.updateMany({where:{id,status:doc.status},data:{status:"VOID"}});
          if(changed.count!==1)throw new CareError(409,"Refresh and retry.");
          await audit(tx,user,null,"DOCUMENT_VOIDED",id);return;
        }
        if(doc.status!=="ISSUED"||!doc.requiredRoles.split(",").includes(user.role)||doc.signatures.some(s=>s.signerRole===user.role))throw new CareError(409,"This document does not require your signature.");
        if(user.role==="doctor"&&doc.createdById!==user.id)throw new CareError(403,"Only the issuing clinician may sign.");
        if(body.digest!==doc.digest||documentDigest(doc,doc.attachment?.digest)!==doc.digest)throw new CareError(409,"Document changed. Refresh and review it.");
        if(user.role==="patient"&&["TREATMENT","PROCEDURE"].includes(doc.category)&&!doc.signatures.some(s=>s.signerRole==="doctor"))throw new CareError(409,"The clinician must sign first.");
        await tx.paperSignature.create({data:{documentId:id,signerId:user.id,signerName:user.name,signerRole:user.role,documentDigest:doc.digest}});
        if(doc.signatures.length+1===doc.requiredRoles.split(",").length)await tx.paperDocument.update({where:{id},data:{status:"SIGNED"}});
        await audit(tx,user,null,"DOCUMENT_SIGNED",id);
      });return reply({ok:true});
    }
    if(action==="remittance"){
      requireRole(user,["admin","billing"]);
      const id=text(body.id,"Claim",100),reference=text(body.reference,"Unique remittance reference",100),amount=moneyInteger(body.amountCents,"Amount");
      if(amount<=0)throw new CareError(400,"Enter a positive amount.");
      await prisma.$transaction(async tx=>{
        const claim=await tx.careClaim.findUnique({where:{id},include:{remittances:true}});
        if(!claim||claim.status!=="APPROVED")throw new CareError(409,"An approved claim is required.");
        if(await tx.claimRemittance.findUnique({where:{reference}}))throw new CareError(409,"Remittance reference already recorded.");
        const total=claim.remittances.reduce((n,r)=>n+r.amountCents,0)+amount;
        if(total>claim.totalCents)throw new CareError(400,"Remittance exceeds the outstanding balance.");
        const changed=await tx.careClaim.updateMany({where:{id,version:claim.version,status:"APPROVED"},data:{version:{increment:1},...(total===claim.totalCents?{status:"PAID",paidAt:new Date()}:{} )}});
        if(changed.count!==1)throw new CareError(409,"Claim changed. Refresh.");
        await tx.claimRemittance.create({data:{claimId:id,reference,amountCents:amount,reason:optionalText(body.reason,"Remittance note",500),recordedById:user.id}});
        await audit(tx,user,claim.encounterId,"REMITTANCE_RECORDED_SIMULATED",reference);
      });return reply({ok:true});
    }
    throw new CareError(400,"Unknown action.");
  }catch(e){return errorResponse(e);}
}
