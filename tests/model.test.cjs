const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const m=require('../src/core/model.cjs');
test('numeric release ordering handles multi-digit minor and patch versions',()=>{
  assert.ok(m.compareVersions('v24.11.0','24.9.9')>0);
  assert.ok(m.compareVersions('26.1.0','24.99.99')>0);
  assert.equal(m.compareVersions('24.1.11','v24.1.11'),0);
});
test('latest update stays in its major and does not confuse LTS with the latest major',()=>{
  const releases=[{version:'v26.13.1',lts:false},{version:'v24.1.11',lts:'Krypton'},{version:'v24.12.0',lts:'Krypton'},{version:'v24.9.1',lts:'Krypton'},{version:'v24.13.0-rc.1'}];
  assert.equal(m.latestInMajor(releases,'24.1.11').version,'v24.12.0');
  assert.equal(m.latestInMajor(releases,'26.13.0').version,'v26.13.1');
  assert.equal(m.latestInMajor(releases,'22.1.0'),null);
});
test('version input rejects commands, traversal, partial and prerelease versions',()=>{
  for(const v of ['24','24.1','../../24.1.1','24.1.1;calc','24.1.1-beta','24.1.1\n','--help'])assert.throws(()=>m.parseVersion(v));
});
test('PATH comparison handles Windows case, quotes, trailing separators',()=>{
  assert.equal(m.normalizePath('"C:\\Program Files\\nodejs\\"'),m.normalizePath('c:\\program files\\nodejs'));
});
test('PATH editing preserves non-Node entries and expansion variables',()=>{
  const raw='%SystemRoot%\\System32;C:\\Tools;C:\\Node';
  assert.deepEqual(m.validateEntries(m.splitPath(raw)),['%SystemRoot%\\System32','C:\\Tools','C:\\Node']);
});
test('PATH input rejects separators, nulls, and excessive length',()=>{
  for(const entry of ['', 'C:\\x;C:\\y','C:\\x\nhello','C:\\x\0'])assert.throws(()=>m.validateEntries([entry]));
  assert.throws(()=>m.validateEntries(['x'.repeat(32001)]));
});
test('existing empty PATH segments are preserved during edits and restore',()=>{
  const raw=';C:\\Tools;;C:\\Node;';
  assert.equal(m.validateEntries(m.splitPath(raw),true).join(';'),raw);
  assert.deepEqual(m.splitPath(''),[]);
});
test('PATH writes reject stale snapshots',()=>{
  assert.throws(()=>m.assertUnchanged('changed','old'),/changed outside/);
  assert.doesNotThrow(()=>m.assertUnchanged('same','same'));
});
test('managed uninstall boundary rejects root, siblings and nested directories',()=>{
  const root=path.resolve('fixture','versions');
  assert.ok(m.isManagedDirectory(root,path.join(root,'v24.11.0-win-x64')));
  assert.ok(m.isManagedDirectory(root,path.join(root,'v24.11.0-win-arm64')));
  for(const target of [root,path.join(root,'..','v24.11.0-win-x64'),path.join(root,'v24.11.0-win-x64','nested'),path.join(root,'custom')]) assert.equal(m.isManagedDirectory(root,target),false);
});
