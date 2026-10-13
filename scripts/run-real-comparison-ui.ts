import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
const database = process.env.TEST_DATABASE_URL;
assert(database && /^faceted_native_test(?:_[a-z0-9]+)?$/.test(new URL(database).pathname.slice(1)), 'Use only an explicitly disposable native test database.');
assert.equal(process.env.TEST_DISPOSABLE_ENGINES, '1', 'The configured engine instances must also be disposable.');
let child: ChildProcess | undefined;
let logs = '';
let base = '';
async function call(path: string, method = 'GET') {
  const response = await fetch(base+path, { method, headers: { 'Content-Type': 'application/json' }, ...(method==='POST'?{body:'{}'}:{}), signal: AbortSignal.timeout(30_000) });
  assert(response.ok, `${path}: ${response.status} ${await response.clone().text()}`);
  return response.json();
}
async function command(args: string[]) {
  const processChild = spawn(process.execPath,args,{stdio:'inherit',env:{...process.env,DEMO_URL:base,SCREENSHOT_BASE_URL:base,FACETED_OWNED_API:'1'}});
  const [code] = await once(processChild,'exit');
  assert.equal(code,0,`Real UI command failed: ${args.join(' ')}`);
}
try {
  await mkdir('test-results/native',{recursive:true});
  child=spawn(process.execPath,['--import','tsx','apps/api/src/main.ts'],{
    env:{...process.env,DATABASE_URL:database,SEARCH_SYNC_PROVIDERS:process.env.TEST_NATIVE_PROVIDERS??'meilisearch,typesense',HOST:'127.0.0.1',PORT:'0'},
    stdio:['ignore','pipe','pipe','ipc']
  });
  child.stdout?.on('data',(data)=>{logs+=data.toString();});
  child.stderr?.on('data',(data)=>{logs+=data.toString();});
  const owned=child;
  const port=await new Promise<number>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error(`Owned API readiness timed out: ${logs}`)),30_000);
    owned.once('error',(error)=>{clearTimeout(timer);reject(error);});
    owned.once('exit',(code)=>{clearTimeout(timer);reject(new Error(`Owned API exited ${code}: ${logs}`));});
    owned.on('message',(value)=>{const message=value as {type:string;port:number};if(message.type==='ready'&&Number.isInteger(message.port)){clearTimeout(timer);resolve(message.port);}});
  });
  base=`http://127.0.0.1:${port}`;
  // A child IPC readiness handshake establishes that this API belongs to this
  // process and uses the validated disposable database. Never seed a discovered
  // fixed-port responder or trust an unrelated DEMO_URL environment value.
  assert.equal((await call('/api/providers')).storageMode,'postgres');
  await call('/api/seed','POST');
  const until=Date.now()+300_000; let ready=false;
  while(Date.now()<until){
    const state=await call('/api/embedding-jobs');
    if(state.documents.current===126&&!state.documents.pending&&!state.documents.projectionPending&&!state.documents.deletedPending&&!state.queue.created&&!state.queue.active&&!state.queue.retry){ready=true;break;}
    if(state.queue.failed&&state.recentFailures.length) throw new Error(JSON.stringify(state));
    await new Promise((resolve)=>setTimeout(resolve,500));
  }
  assert(ready,'Real native indexes did not become ready within five minutes.');
  await command(['node_modules/@playwright/test/cli.js','test','--config','playwright.real.config.ts']);
  if(process.env.REAL_UI_CAPTURE!=='0') await command(['--import','tsx','scripts/capture-screenshots.ts']);
} finally {
  if(child&&child.exitCode===null){const stopped=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child?.kill('SIGKILL'),15_000);await stopped;clearTimeout(timer);}
  await mkdir('test-results/native',{recursive:true});
  await writeFile('test-results/native/ui-api.log',logs);
}
