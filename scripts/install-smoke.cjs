// Exercises a real official download in an isolated temporary app-data directory.
// Never writes User/Machine PATH or modifies existing installations.
const {Manager}=require('../src/core/manager.cjs');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
async function main(){
  const data=await fs.mkdtemp(path.join(os.tmpdir(),'node-manager-install-'));
  const manager=new Manager(data,event=>{if(event.type==='progress')console.log(event.message);});
  const before=process.env.PATH;
  try{
    const catalog=await manager.catalog();
    const arch=process.arch==='arm64'?'arm64':'x64';
    const release=catalog.releases.find(r=>r.lts&&r.files.includes(`win-${arch}-zip`));
    assert.ok(release,'An LTS Windows ZIP is available');
    const directory=await manager.install(release.version);
    const snapshot=await manager.discover();
    const installation=snapshot.installations.find(i=>i.directory===directory);
    assert.equal(installation.managed,true);assert.equal(installation.version,release.version);assert.equal(installation.pathPosition,null);
    await manager.uninstall(directory);
    await assert.rejects(fs.access(directory));
    assert.equal(process.env.PATH,before);
    console.log(`Live verified install, discovery and uninstall passed for ${release.version}; system PATH unchanged.`);
  }finally{
    const resolved=await fs.realpath(data);
    assert.ok(resolved.startsWith(path.join(os.tmpdir(),'node-manager-install-')));
    await fs.rm(resolved,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
