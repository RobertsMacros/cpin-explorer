// Operator-only bootstrap after the owner has registered through the real password form.
// It cannot be invoked by a web request or grant an account ownership from its email alone.
import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
const args=process.argv.slice(2), email=args[args.indexOf("--email")+1];
const local=args.includes("--local"), remote=args.includes("--remote");
if(!args.includes("--email") || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email||"") || local===remote) {
  console.error("Use: node accounts/promote-owner.mjs --email ADDRESS --local|--remote [--config FILE] [--persist-to DIRECTORY]");process.exit(1);
}
const scratch=path.resolve(import.meta.dirname,"../../.local");await mkdir(scratch,{recursive:true});
const file=path.join(scratch,`owner-bootstrap-${crypto.randomUUID()}.sql`);
const literal="'"+email.trim().toLowerCase().replaceAll("'","''")+"'";
await writeFile(file,`UPDATE "user" SET role='owner',approved=1,updatedAt=${Date.now()} WHERE email=${literal} AND NOT EXISTS(SELECT 1 FROM "user" WHERE role='owner');\nSELECT id,email,role,approved FROM "user" WHERE email=${literal};\n`,{mode:0o600});
try {
  const command=[path.resolve(import.meta.dirname,"../node_modules/wrangler/bin/wrangler.js"),"d1","execute","ACCOUNTS",local ? "--local" : "--remote","--file",file,"--json"];
  for(const flag of ["--config","--persist-to"])if(args.includes(flag))command.push(flag,args[args.indexOf(flag)+1]);
  const child=spawn(process.execPath,command,{stdio:["ignore","pipe","pipe"],cwd:path.resolve(import.meta.dirname,".."),env:{...process.env,CI:"true",WRANGLER_SEND_METRICS:"false"}});
  let output="",error="",verified=false;
  const timeout=setTimeout(()=>child.kill("SIGINT"),30000);
  child.stdout.on("data",chunk=>{
    output+=chunk;
    try {
      const parsed=JSON.parse(output);
      const row=parsed.flatMap(r=>r.results||[]).find(r=>r.email===email.trim().toLowerCase());
      verified=parsed.every(r=>r.success)&&row?.role==="owner"&&!!row.approved;
      // Some Node/Wrangler combinations retain the local runtime after a completed
      // command. Only stop after its complete JSON readback verifies the exact row.
      if(verified)child.kill("SIGINT");
    } catch {}
  });
  child.stderr.on("data",chunk=>error+=chunk);
  await new Promise((resolve,reject)=>{child.once("error",reject);child.once("close",resolve);});
  clearTimeout(timeout);
  if(!verified){console.error("Owner promotion was not verified. Check that the registered email exists and no different owner is configured.");if(error)console.error(error);process.exitCode=1;}
  else console.log("Registered owner approved; exact account readback verified.");
} finally {await rm(file,{force:true});}
