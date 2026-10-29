// Electron's native application automation; no external browser is used.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const packaged = process.argv.includes('--packaged');
async function launch(mode, callback) {
  const data = await fs.mkdtemp(path.join(os.tmpdir(),'node-manager-ui-'));
  const env = {...process.env, NODE_MANAGER_TEST_DATA:data};
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({...(packaged?{executablePath:path.resolve('release','win-unpacked','Node Manager.exe')}:{}),args:[...(packaged?[]:[path.resolve('.')]),...(mode==='demo'?['--demo']:[])],env,timeout:30000});
  const errors=[];
  try {
    const page=await app.firstWindow();
    page.on('pageerror',error=>errors.push(error.message));
    await page.locator('#installed-count').filter({hasText:/\d/}).waitFor();
    await page.waitForFunction(()=>document.querySelector('#operation-status').textContent==='Ready'&&!document.body.classList.contains('busy'));
    await callback(page,app);
    assert.deepEqual(errors,[],'No renderer exceptions');
  } finally { await app.close(); await fs.rm(data,{recursive:true,force:true}); }
}
async function main() {
  await fs.mkdir('artifacts',{recursive:true});
  await launch('demo',async page=>{
    assert.equal(await page.locator('.version-card').count(),3);
    await page.screenshot({path:'artifacts/versions.png',fullPage:true});
    await page.locator('#search').fill('v22');assert.equal(await page.locator('.version-card').count(),1);
    await page.locator('#search').fill('unmatched');assert.equal(await page.locator('.empty').count(),1);
    await page.locator('#search').fill('');
    await page.locator('#version-filter').selectOption('updates');assert.equal(await page.locator('.version-card').count(),2);
    await page.locator('#version-filter').selectOption('all');
    await page.getByRole('button',{name:'Add to PATH',exact:true}).first().click();
    assert.equal(await page.locator('#path-dirty').textContent(),'Unsaved changes');
    await page.screenshot({path:'artifacts/path.png',fullPage:true});
    await page.locator('#discard-path').click();assert.equal(await page.locator('#path-dirty').textContent(),'No unsaved changes');
    await page.getByRole('button',{name:'Machine PATH',exact:true}).click();assert.equal(await page.locator('#save-path').isDisabled(),true);
    await page.locator('[data-page="chocolatey"]').click();assert.equal(await page.locator('.package-card').count(),3);
    assert.equal(await page.locator('#choco-specific').isDisabled(),true);
    await page.screenshot({path:'artifacts/chocolatey.png',fullPage:true});
    await page.locator('[data-page="activity"]').click();await page.locator('#activity-log').filter({hasText:'Preview mode'}).waitFor();
    await page.locator('[data-page="versions"]').click();
    await page.locator('#open-install').click();assert.equal(await page.locator('#install-dialog').isVisible(),true);
    assert.ok(await page.locator('#release-select option').count()>0);
    await page.getByRole('button',{name:'Close install dialog'}).click();
    await page.setViewportSize({width:1000,height:700});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No horizontal overflow at minimum width');
    await page.screenshot({path:'artifacts/versions-compact.png',fullPage:true});
  });
  if(!packaged) await launch('live',async page=>{
    assert.ok(await page.locator('.version-card').count()>0,'Live discovery finds this Windows installation');
    assert.match(await page.locator('#catalog-status').textContent(),/nodejs.org|Offline/);
    await page.screenshot({path:'artifacts/live-versions.png',fullPage:true});
  });
  console.log(`${packaged?'Packaged':'Development'} desktop smoke checks passed: ${packaged?'':'live discovery, '}demo flows, filtering, PATH drafts, permissions, packages, activity, install dialog, and compact layout.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
