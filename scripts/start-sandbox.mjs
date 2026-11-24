import { spawnSync, spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";
if(process.env.SANDBOX_GATE_REQUIRED!=="1" || (process.env.SANDBOX_ACCESS_PASSWORD||"").length<20) throw Error("Configure a private sandbox access password of at least 20 characters.");
if(process.env.DATABASE_URL!=="file:/var/data/ubuntucare-demo.db") throw Error("Use the dedicated synthetic sandbox database.");
function run(command,args){const result=spawnSync(command,args,{stdio:"inherit"});if(result.status!==0)throw Error(command+" failed");}
run("npm",["run","db:push"]);
const db=new PrismaClient();
try {
 if(await db.user.count()===0) {
   if(await db.patientProfile.count()!==0)throw Error("Unexpected existing data; refusing to seed.");
   run("npm",["run","db:seed"]);
 }
}finally{await db.$disconnect();}
const child=spawn("npm",["start","--","--hostname","0.0.0.0"],{stdio:"inherit"});
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>child.kill(signal));
child.on("exit",code=>process.exit(code??1));
