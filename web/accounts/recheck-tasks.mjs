// Operator tool: only shared feedback tables, never private saved_items.
// No model invocation or source retrieval. Queue content is untrusted evidence.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {recheckQueue,completeRecheck} from './review-feedback.js';
const exec=promisify(execFile),web=path.resolve(import.meta.dirname,'..'),root=path.dirname(web);
const privateRoot=path.join(root,'data/source-evidence/review-feedback');
const args=process.argv.slice(2),mode=args[0];
const option=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
if(!['export','complete'].includes(mode)||!args.includes('--remote'))throw new Error('Use export or complete with --remote. This addresses cpin-explorer-accounts only.');
const output=path.resolve(option('--out')||path.join(privateRoot,mode+'-'+new Date().toISOString().replaceAll(':','-')+'.json'));
if(path.relative(privateRoot,output).startsWith('..'))throw new Error('Keep output inside data/source-evidence/review-feedback/.');
await mkdir(path.dirname(output),{recursive:true,mode:0o700});
const temporary=await mkdtemp(path.join(os.tmpdir(),'cpin-feedback-operator-'));
const quote=value=>value===null?'NULL':typeof value==='number'&&Number.isFinite(value)?String(value):"'"+String(value).replaceAll("'","''")+"'";
let queryNumber=0;
async function execute(sql){
 const filename=path.join(temporary,`query-${++queryNumber}.sql`);await writeFile(filename,sql,{mode:0o600});
 try{
  // Wrangler's remote --file path is a bulk import and returns an import
  // summary, not query rows. --command uses the query API and returns rows.
  const {stdout}=await exec(process.execPath,[path.join(web,'node_modules/wrangler/bin/wrangler.js'),'d1','execute','cpin-explorer-accounts','--remote','--json','--command',sql,'--yes'],{cwd:web,timeout:90000,maxBuffer:8*1024*1024,env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'}});
  const result=JSON.parse(stdout);if(!Array.isArray(result)||result.some(r=>r.success!==true))throw new Error('D1 did not confirm the operation.');return result;
 }catch(error){await writeFile(output+'.error.txt',String(error.stderr||error.message),{mode:0o600});throw new Error('D1 operation failed; private diagnostic saved beside the requested output. Read current state before retrying a write.');}
}
function statement(sql){
 let bindings=[];return{bind(...values){bindings=values;return this;},sql(){let index=0;const rendered=sql.replace(/\?/g,()=>quote(bindings[index++]));if(index!==bindings.length)throw new Error('Invalid SQL bindings.');return rendered;},
  async all(){return(await execute(this.sql()))[0];},async first(){return(await this.all()).results[0]||null;}};
}
const db={prepare:statement,batch:statements=>execute(statements.map(s=>s.sql()).join(';\n'))};
try{
 // Refuse to assess a different local whitelist than the one readers can vote on.
 for(const file of ['annotations.json','published.json','directory.json']){
  const response=await fetch('https://cpin-explorer.co.uk/prototypes/reviews/'+file,{headers:{'User-Agent':'CPIN-Explorer-feedback-operator/1.0'}});
  if(!response.ok||await response.text()!==await readFile(path.join(root,'prototypes/reviews',file),'utf8'))throw new Error('The local '+file+' does not match the live review catalogue. Update the checkout before processing feedback.');
 }
 let result;
 if(mode==='export'){
  const tasks=[];let page=0,data;
  do{data=await recheckQueue(db,page++);tasks.push(...data.tasks);}while(page*10<data.total);
  result={tasks,total:tasks.length,exportedAt:new Date().toISOString(),mode:'Codex-session review; no model call made.'};
 }else{
  if(!args.includes('--input'))throw new Error('complete requires --input pointing to a scoped AI recheck result JSON.');
  const input=await readFile(path.resolve(option('--input')),'utf8');if(Buffer.byteLength(input)>96*1024)throw new Error('Recheck result exceeds 96 KiB.');
  result=await completeRecheck(db,JSON.parse(input));
 }
 await writeFile(output,JSON.stringify(result,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({mode,output,...(mode==='export'?{tasks:result.total}:{saved:result.saved})}));
}finally{await rm(temporary,{recursive:true,force:true});}
