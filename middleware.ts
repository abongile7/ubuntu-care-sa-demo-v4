import { NextRequest, NextResponse } from "next/server";
// Private shared test gate only. The normal application role/session checks remain in place.
async function same(a:string,b:string){const encoder=new TextEncoder();const [x,y]=await Promise.all([crypto.subtle.digest("SHA-256",encoder.encode(a)),crypto.subtle.digest("SHA-256",encoder.encode(b))]);const u=new Uint8Array(x),v=new Uint8Array(y);let diff=0;for(let i=0;i<u.length;i++)diff|=u[i]^v[i];return diff===0;}
export async function middleware(request:NextRequest){
 if(process.env.SANDBOX_GATE_REQUIRED!=="1")return NextResponse.next();
 const secret=process.env.SANDBOX_ACCESS_PASSWORD||"";
 if(secret.length<20)return new NextResponse("Sandbox configuration incomplete.",{status:503});
 let credentials="";
 try{const header=request.headers.get("authorization")||"";if(header.startsWith("Basic "))credentials=atob(header.slice(6));}catch{}
 if(await same(credentials,"tester:"+secret))return NextResponse.next();
 return new NextResponse("Private synthetic-data sandbox. Ask the owner for test access.",{status:401,headers:{"WWW-Authenticate":'Basic realm="UbuntuCare private sandbox", charset="UTF-8"',"Cache-Control":"no-store"}});
}
export const config={matcher:["/((?!api/health$).*)"]};
