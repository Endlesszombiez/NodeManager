const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {Manager}=require('../src/core/manager.cjs');
const win=require('../src/core/windows.cjs');
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'node-manager-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  return new Manager(root);
}
test('failed catalog request falls back to dated cache',async t=>{
  const manager=await fixture(t);
  await fs.writeFile(path.join(manager.dataDir,'catalog.json'),JSON.stringify({releases:[{version:'v24.11.0',files:[]}],date:'2026-01-01'}));
  t.mock.method(global,'fetch',async()=>{throw new Error('offline');});
  const result=await manager.catalog();
  assert.equal(result.offline,true);assert.equal(result.date,'2026-01-01');assert.equal(manager.releases[0].version,'v24.11.0');
});
test('catalog offline without cache reports an actionable failure',async t=>{
  const manager=await fixture(t);t.mock.method(global,'fetch',async()=>{throw new Error('offline');});
  await assert.rejects(manager.catalog(),/Installed versions and PATH still work/);
});
test('exclusive operations reject overlapping work and clear busy state after failure',async t=>{
  const manager=await fixture(t);let release;
  const pending=manager.exclusive('test',()=>new Promise(resolve=>{release=resolve;}));
  await new Promise(resolve=>setTimeout(resolve,30));
  await assert.rejects(manager.exclusive('overlap',()=>{}),/Another operation/);
  release();await pending;assert.equal(manager.busy,false);
  await assert.rejects(manager.exclusive('failure',()=>{throw new Error('failed');}),/failed/);assert.equal(manager.busy,false);
});
test('a log write failure releases the operation lock so the app can close',async t=>{
  const manager=await fixture(t);t.mock.method(manager,'log',async()=>{throw new Error('Disk full');});
  await assert.rejects(manager.exclusive('test',async()=>{}),/Disk full/);
  assert.equal(manager.busy,false);
});
test('checksum mismatch never extracts or installs and cleans staging',async t=>{
  const manager=await fixture(t);const name=`node-v24.11.0-win-${process.arch==='arm64'?'arm64':'x64'}.zip`;
  t.mock.method(global,'fetch',async url=>url.endsWith('SHASUMS256.txt')?new Response('a'.repeat(64)+'  '+name):new Response('tampered archive'));
  const ps=t.mock.method(win,'ps',async()=>{throw new Error('Must not extract');});
  await assert.rejects(manager.install('24.11.0'),/SHA-256 verification failed/);
  assert.equal(ps.mock.callCount(),0);assert.deepEqual(await fs.readdir(path.join(manager.dataDir,'downloads')),[]);
  await assert.rejects(fs.access(manager.root));
});
test('verified install records provenance and leaves PATH unchanged',async t=>{
  const manager=await fixture(t);const arch=process.arch==='arm64'?'arm64':'x64';const name=`node-v24.11.0-win-${arch}`;
  const archive=Buffer.from('test archive');const hash=crypto.createHash('sha256').update(archive).digest('hex');
  t.mock.method(global,'fetch',async url=>url.endsWith('SHASUMS256.txt')?new Response(hash+'  '+name+'.zip'):new Response(archive));
  t.mock.method(win,'ps',async()=>{
    const [staging]=await fs.readdir(path.join(manager.dataDir,'downloads'));const dir=path.join(manager.dataDir,'downloads',staging,name);
    await fs.mkdir(dir);await fs.writeFile(path.join(dir,'node.exe'),'fixture');
  });
  t.mock.method(win,'run',async()=>({code:0,output:'v24.11.0'}));
  const oldPath=process.env.PATH;const directory=await manager.install('24.11.0');
  const manifest=JSON.parse(await fs.readFile(path.join(directory,'.node-manager.json'),'utf8'));
  assert.equal(manifest.checksum,hash);assert.equal(manifest.version,'v24.11.0');assert.ok(manifest.installed);assert.equal(process.env.PATH,oldPath);
  await assert.rejects(manager.install('24.11.0'),/already installed/);
});
test('uninstall refuses installations still present in either PATH scope',async t=>{
  const manager=await fixture(t);
  t.mock.method(manager,'discover',async()=>({installations:[{directory:'C:\\Node',managed:true,inMachinePath:true}]}));
  await assert.rejects(manager.uninstall('C:\\Node'),/Remove this version from both PATH/);
});
test('managed uninstall cannot delete a directory outside its root',async t=>{
  const manager=await fixture(t);const outside=path.join(manager.dataDir,'do-not-delete');await fs.mkdir(outside);
  t.mock.method(manager,'discover',async()=>({installations:[{directory:outside,managed:true}]}));
  await assert.rejects(manager.uninstall(outside),/outside/);await fs.access(outside);
});
test('Chocolatey rejects arbitrary package names and command payloads',async t=>{
  const manager=await fixture(t);
  await assert.rejects(manager.chocolatey('install','other-package'),/Unsupported/);
  await assert.rejects(manager.chocolatey('install','nodejs','24.1.1;calc'),/Expected a stable/);
});
test('Chocolatey requires administrator access before executing a package',async t=>{
  const manager=await fixture(t);t.mock.method(win,'facts',async()=>({admin:false}));
  const run=t.mock.method(win,'run',async()=>{throw new Error('Must not run');});
  await assert.rejects(manager.chocolatey('install','nodejs-lts'),/administrator/);
  assert.equal(run.mock.callCount(),0);
});
test('Chocolatey runs literal allowlisted arguments and surfaces reboot status',async t=>{
  const manager=await fixture(t),executable=path.join(manager.dataDir,'choco.exe');await fs.writeFile(executable,'fixture');
  t.mock.method(manager,'chocoPath',()=>executable);t.mock.method(win,'facts',async()=>({admin:true}));
  const run=t.mock.method(win,'run',async()=>({code:3010,output:'Package installed',errors:''}));
  const result=await manager.chocolatey('install','nodejs-lts','v24.11.0');
  assert.equal(result.rebootRequired,true);
  assert.equal(run.mock.calls[0].arguments[0],executable);
  assert.deepEqual(run.mock.calls[0].arguments[1],['install','nodejs-lts','--yes','--no-progress','--limit-output','--no-color','--version=24.11.0']);
});
test('managed uninstall refuses a running runtime before deleting files',async t=>{
  const manager=await fixture(t),directory=path.join(manager.root,'v24.11.0-win-x64');await fs.mkdir(directory,{recursive:true});
  t.mock.method(manager,'discover',async()=>({installations:[{directory,managed:true,running:true}]}));
  await assert.rejects(manager.uninstall(directory),/is running/);await fs.access(directory);
});
