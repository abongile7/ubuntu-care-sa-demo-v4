import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuthSession } from "@/lib/auth";
import { audit, CareError, errorResponse, jsonObject, optionalText, ref, requireRole, text, versionNumber, type Actor } from "@/lib/care-access";
import { checkOrigin, digest } from "@/lib/paperless";
import type { Prisma } from "@prisma/client";
import { scope } from "@/lib/intake-access";
const reply=(data:object)=>NextResponse.json(data,{headers:{"Cache-Control":"private, no-store",Vary:"Cookie"}});
export async function GET(){
 try{
 const {user}=await requireAuthSession();const where=scope(user);
 const records=await prisma.arrivalIntake.findMany({where,include:{attachment:{select:{fileName:true,digest:true}}},orderBy:{updatedAt:"desc"},take:100});
 const doctors=user.role==="admin"?await prisma.user.findMany({where:{role:"doctor"},select:{id:true,name:true,unit:true}}):[];
 const patients=user.role==="admin"?await prisma.patientProfile.findMany({select:{id:true,fullName:true,facilityFileNumber:true},take:200}):[];
 return reply({records,doctors,patients});
 }catch(e){return errorResponse(e);}
}
export async function POST(request:Request){
 try{
 checkOrigin(request);const {user}=await requireAuthSession();const where=scope(user);
 const raw=await request.text();if(raw.length>3000000)throw new CareError(413,"File too large.");
 const body=jsonObject(JSON.parse(raw)),action=text(body.action,"Action",30);
 if(action==="create"){
  requireRole(user,["admin","paramedic","nurse"]);
  const mode=text(body.mode,"Arrival mode",30);
  if(!["WALK_IN","AMBULANCE","TRANSFER","ELECTIVE","REFERRAL"].includes(mode)||user.role==="paramedic"&&!["AMBULANCE","TRANSFER"].includes(mode))throw new CareError(400,"Choose an allowed arrival mode.");
  const identityStatus=text(body.identityStatus,"Identity status",30);
  if(!["UNIDENTIFIED","SELF_REPORTED","DOCUMENT_PRESENTED"].includes(identityStatus))throw new CareError(400,"Choose identity status.");
  const reference=ref("INTAKE"), patientLabel=identityStatus==="UNIDENTIFIED"?"Temporary "+reference.slice(-8):text(body.patientLabel,"Fictional patient name",160);
  const etaRaw=optionalText(body.eta,"ETA",50),eta=etaRaw?new Date(etaRaw):null;
  if(eta&&!Number.isFinite(+eta))throw new CareError(400,"Invalid ETA.");
  let attachment:{fileName:string;digest:string;bytes:Uint8Array<ArrayBuffer>}|undefined;
  if(body.file!==undefined){
    if(body.shareAuthorized!==true)throw new CareError(403,"Confirm the synthetic referral is authorised for sharing.");
    const encoded=typeof body.file==="string"?body.file:"";
    if(!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw new CareError(400,"Invalid PDF.");
    const bytes=Buffer.from(encoded,"base64");
    if(bytes.length>2*1024*1024||bytes.subarray(0,5).toString()!=="%PDF-")throw new CareError(400,"Choose a PDF up to 2 MiB.");
    attachment={fileName:text(body.fileName,"Filename",120).replace(/[^a-zA-Z0-9._-]/g,"_"),digest:digest(bytes),bytes:new Uint8Array(bytes)};
  }
  const created=await prisma.$transaction(async tx=>{
   const row=await tx.arrivalIntake.create({data:{reference,mode,identityStatus,patientLabel,sourceFacility:mode==="TRANSFER"?text(body.sourceFacility,"Sending facility",160):optionalText(body.sourceFacility,"Source",160),destinationUnit:text(body.destinationUnit,"Receiving unit",100),eta,summary:text(body.summary,"Handover summary",2000),observations:optionalText(body.observations,"Observations",2000),treatment:optionalText(body.treatment,"Treatment provided",2000),createdById:user.id,createdByName:user.name,status:mode==="WALK_IN"?"ARRIVED":"PRE_ALERT",arrivedAt:mode==="WALK_IN"?new Date():null,...(attachment?{attachment:{create:attachment}}:{})}});
   await audit(tx,user,null,"INTAKE_CREATED",row.id);return row;
  });return reply({ok:true,id:created.id});
 }
 const id=text(body.id,"Intake",100),version=versionNumber(body.version);
 await prisma.$transaction(async tx=>{
  const row=await tx.arrivalIntake.findFirst({where:{id,...where}});
  if(!row)throw new CareError(404,"Intake not found.");
  if(row.version!==version||["HANDED_OVER","CANCELLED"].includes(row.status))throw new CareError(409,"Refresh: intake changed or closed.");
  let data:Prisma.ArrivalIntakeUpdateManyMutationInput={version:{increment:1}};
  if(action==="assign"){
   requireRole(user,["admin"]);const doctorId=text(body.doctorId,"Doctor",100);
   if(!await tx.user.findFirst({where:{id:doctorId,role:"doctor"}}))throw new CareError(400,"Choose receiving clinician.");
   data={...data,assignedDoctorId:doctorId,acknowledgedAt:null};
  }else if(action==="link"){
   requireRole(user,["admin"]);
   const patientId=text(body.patientId,"Patient",100);
   if(body.confirm!==true)throw new CareError(400,"Confirm manual identity matching.");
   if(row.patientId)throw new CareError(409,"Already linked; correction needs administrator review.");
   if(!await tx.patientProfile.findUnique({where:{id:patientId}}))throw new CareError(404,"Patient not found.");
   data={...data,patientId};
  }else if(action==="acknowledge"){
   requireRole(user,["doctor"]);if(row.acknowledgedAt)throw new CareError(409,"Already acknowledged.");
   data={...data,acknowledgedAt:new Date()};
  }else if(action==="arrive"){
   requireRole(user,["admin","nurse","paramedic"]);if(row.status!=="PRE_ALERT")throw new CareError(409,"Already arrived.");
   data={...data,status:"ARRIVED",arrivedAt:new Date()};
  }else if(action==="handover"){
   requireRole(user,["admin","nurse","doctor"]);if(row.status!=="ARRIVED")throw new CareError(409,"Record arrival first.");
   data={...data,status:"HANDED_OVER"};
  }else if(action==="cancel"){
   requireRole(user,["admin"]);data={...data,status:"CANCELLED"};
  }else throw new CareError(400,"Unknown action.");
  const changed=await tx.arrivalIntake.updateMany({where:{id,version},data});
  if(changed.count!==1)throw new CareError(409,"Refresh and retry.");
  await audit(tx,user,null,"INTAKE_"+action.toUpperCase(),id);
 });return reply({ok:true});
 }catch(e){return errorResponse(e);}
}
