import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getAuthSession, requireAuthSession } from "@/lib/auth";
import { domains, simulate, type Domain } from "@/lib/integration-sandbox";
import { audit, CareError, errorResponse, jsonObject, text } from "@/lib/care-access";
import { checkOrigin } from "@/lib/paperless";
import { prisma } from "@/lib/prisma";
const response=(data:object)=>NextResponse.json(data,{headers:{"Cache-Control":"private, no-store",Vary:"Cookie"}});
export async function GET(){try{const {user}=await requireAuthSession();const allowed=Object.entries(domains).filter(([,d])=>(d.roles as readonly string[]).includes(user.role));if(!allowed.length)throw new CareError(403,"No integration simulator access.");return response({domains:allowed.map(([id,d])=>({id,...d})),providerConnected:false});}catch(e){return errorResponse(e);}}
export async function POST(request:Request){try{checkOrigin(request);const {user}=await requireAuthSession();const body=jsonObject(await request.json());const domain=text(body.domain,"Domain",30) as Domain;const config=Object.hasOwn(domains,domain)?domains[domain]:null;if(!config||!(config.roles as readonly string[]).includes(user.role))throw new CareError(403,"Integration not available to this role.");const scenario=text(body.scenario,"Scenario",80);if(!(config.scenarios as readonly string[]).includes(scenario))throw new CareError(400,"Unknown synthetic scenario.");const result=simulate(domain,scenario,randomUUID());await audit(prisma,user,null,"PARTNER_CONTRACT_SIMULATED",domain+" "+scenario+" "+result.requestId);return response(result);}catch(e){return errorResponse(e);}}
