import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { audit,CareError,errorResponse,jsonObject,requireRole,text,versionNumber } from "@/lib/care-access";
import { checkOrigin } from "@/lib/paperless";
const reply=(data:object)=>NextResponse.json(data,{headers:{"Cache-Control":"private, no-store",Vary:"Cookie"}});
function quantity(v:unknown,minimum=1){if(typeof v!=="number"||!Number.isSafeInteger(v)||v<minimum||v>100000)throw new CareError(400,"Enter a whole quantity in range.");return v;}
export async function GET(){try{const {user}=await requireAuthSession();requireRole(user,["admin","nurse"]);const [beds,supplies,intakes]=await Promise.all([prisma.demoBed.findMany({orderBy:{code:"asc"}}),prisma.demoSupply.findMany({include:{movements:{orderBy:{createdAt:"desc"},take:10}},orderBy:{code:"asc"}}),prisma.arrivalIntake.findMany({where:{status:{in:["ARRIVED","HANDED_OVER"]}},select:{id:true,reference:true,patientLabel:true,status:true},take:100})]);return reply({beds,supplies,intakes});}catch(e){return errorResponse(e);}}
export async function POST(request:Request){try{checkOrigin(request);const {user}=await requireAuthSession();requireRole(user,["admin","nurse"]);const b=jsonObject(await request.json()),action=text(b.action,"Action",30);
await prisma.$transaction(async tx=>{
 if(action==="createBed"){requireRole(user,["admin"]);const code=text(b.code,"Bed code",30);if(await tx.demoBed.findUnique({where:{code}}))throw new CareError(409,"Bed exists.");const row=await tx.demoBed.create({data:{code,ward:text(b.ward,"Ward",100)}});await audit(tx,user,null,"DEMO_BED_CREATED",row.id);return;}
 if(action==="createSupply"){requireRole(user,["admin"]);const code=text(b.code,"Stock code",30);if(await tx.demoSupply.findUnique({where:{code}}))throw new CareError(409,"Stock code exists.");const row=await tx.demoSupply.create({data:{code,name:text(b.name,"Non-medication supply",100),unit:text(b.unit,"Unit",30),reorderAt:quantity(b.reorderAt,0)}});await audit(tx,user,null,"DEMO_SUPPLY_CREATED",row.id);return;}
 const id=text(b.id,"Record",100),version=versionNumber(b.version);
 if(action==="allocate"||action==="release"||action==="clean"){
 const row=await tx.demoBed.findUnique({where:{id}});if(!row)throw new CareError(404,"Bed not found.");if(row.version!==version)throw new CareError(409,"Refresh and retry.");
 let status:string,intakeId:string|null=null;
 if(action==="allocate"){if(row.status!=="AVAILABLE")throw new CareError(409,"Bed unavailable.");intakeId=text(b.intakeId,"Arrival record",100);const intake=await tx.arrivalIntake.findUnique({where:{id:intakeId}});if(!intake||!["ARRIVED","HANDED_OVER"].includes(intake.status))throw new CareError(400,"Choose an arrived patient.");if(await tx.demoBed.findUnique({where:{intakeId}}))throw new CareError(409,"Patient already allocated.");status="OCCUPIED";}
 else if(action==="release"){if(row.status!=="OCCUPIED")throw new CareError(409,"Bed not occupied.");status="CLEANING";}
 else{if(row.status!=="CLEANING")throw new CareError(409,"Bed not awaiting cleaning.");status="AVAILABLE";}
 const result=await tx.demoBed.updateMany({where:{id,version},data:{status,intakeId,version:{increment:1}}});if(result.count!==1)throw new CareError(409,"Refresh and retry.");await audit(tx,user,null,"DEMO_BED_"+action.toUpperCase(),id);return;
 }
 if(action==="moveStock"){const row=await tx.demoSupply.findUnique({where:{id}});if(!row)throw new CareError(404,"Stock not found.");if(row.version!==version)throw new CareError(409,"Refresh and retry.");const direction=text(b.direction,"Direction",10),count=quantity(b.quantity),reason=text(b.reason,"Reason",200);if(!["IN","OUT"].includes(direction))throw new CareError(400,"Invalid direction.");const next=row.quantity+(direction==="IN"?count:-count);if(next<0||next>100000)throw new CareError(409,"Quantity would be out of range.");const result=await tx.demoSupply.updateMany({where:{id,version},data:{quantity:next,version:{increment:1}}});if(result.count!==1)throw new CareError(409,"Refresh and retry.");await tx.demoSupplyMovement.create({data:{supplyId:id,direction,quantity:count,reason,actorId:user.id}});await audit(tx,user,null,"DEMO_STOCK_MOVEMENT",id);return;}
 throw new CareError(400,"Unknown action.");
});return reply({ok:true});}catch(e){return errorResponse(e);}}
