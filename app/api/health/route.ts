import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export const dynamic="force-dynamic";
export async function GET(){
 try{await prisma.user.findFirst({select:{id:true}});return NextResponse.json({ok:true,environment:"synthetic-demo"},{headers:{"Cache-Control":"no-store"}});}catch{return NextResponse.json({ok:false},{status:503});}
}
