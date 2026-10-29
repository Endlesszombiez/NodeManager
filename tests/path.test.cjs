const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const win=require('../src/core/windows.cjs');
const {Manager}=require('../src/core/manager.cjs');
test('PATH save writes exact backup, escapes apostrophes, and preserves other scope',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nm-path-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const old=process.env.PATH;t.after(()=>{process.env.PATH=old;});
  const scripts=[];const previous="%USERPROFILE%\\Tools;C:\\O'Brien\\node";
  const execute=async script=>{
    scripts.push(script);
    if(script.includes('SetEnvironmentVariable'))return '';
    if(script.includes("'Machine'"))return JSON.stringify('C:\\Windows\\System32');
    return JSON.stringify(previous);
  };
  const entries=["C:\\O'Brien\\node",'%USERPROFILE%\\Tools'];
  await win.savePath('User',entries,previous,dir,execute);
  const [file]=await fs.readdir(path.join(dir,'path-backups'));
  const backup=JSON.parse(await fs.readFile(path.join(dir,'path-backups',file),'utf8'));
  assert.equal(backup.value,previous);assert.equal(backup.saved,entries.join(';'));assert.equal(backup.scope,'User');
  assert.ok(scripts.some(s=>s.includes("C:\\O''Brien\\node")));assert.ok(scripts.some(s=>s.includes('-cne $expected')));
  assert.equal(process.env.PATH,win.expandEnv('C:\\Windows\\System32;'+entries.join(';')));
});
test('stale PATH rejects before backup or mutation',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nm-path-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  let calls=0;
  await assert.rejects(win.savePath('User',['C:\\Node'],'old',dir,async()=>{calls++;return JSON.stringify('external change');}),/changed outside/);
  assert.equal(calls,1);assert.deepEqual(await fs.readdir(dir),[]);
});
test('restore uses saved value as optimistic concurrency condition',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nm-path-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const folder=path.join(dir,'path-backups');await fs.mkdir(folder);
  await fs.writeFile(path.join(folder,'1000.json'),JSON.stringify({scope:'User',value:'C:\\Old',saved:'C:\\New'}));
  const save=t.mock.method(win,'savePath',async()=>{});
  assert.equal(await new Manager(dir).restorePath(),'User');
  assert.deepEqual(save.mock.calls[0].arguments,['User',['C:\\Old'],'C:\\New',dir]);
});
test('PowerShell arguments quote literal apostrophes without interpreting commands',()=>{
  assert.equal(win.psQuote("C:\\O'Brien; $(Get-Secret)"),"'C:\\O''Brien; $(Get-Secret)'");
});
