/* All system operations cross the restricted preload bridge. No Node.js in this renderer. */
const api = window.nodeManager;
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const state = { snapshot:null, catalog:null, page:'versions', scope:'User', drafts:{User:[],Machine:[]}, busy:false, localBusy:false };
const labels = { versions:'Installed versions', path:'PATH editor', chocolatey:'Chocolatey', activity:'Activity' };
const pathEntries = value => value ? value.split(';') : [];
const samePath = (a,b) => a.replace(/^"|"$/g,'').replace(/\\+$/,'').toLowerCase() === b.replace(/^"|"$/g,'').replace(/\\+$/,'').toLowerCase();
const date = value => value ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T12:00:00':value).toLocaleDateString(undefined, {month:'short',day:'numeric',year:'numeric'}) : 'Not available';
const el = (tag, className, text) => { const element = document.createElement(tag); if(className) element.className=className; if(text !== undefined) element.textContent=text; return element; };
function notice(message, error=false) { $('#notice').textContent=message; $('#notice').classList.toggle('error',error); $('#notice').classList.toggle('hidden',!message); }
function lockButton(element,disabled) { element.dataset.locked=String(disabled);element.disabled=disabled||isBusy(); }
function button(text, callback, className='button', disabled=false, title='') { const b=el('button',className,text); b.type='button'; lockButton(b,disabled); b.title=title; b.addEventListener('click', callback); return b; }
function isBusy() { return state.busy || state.localBusy; }
function updateBusy() {
  document.body.classList.toggle('busy',isBusy());
  for(const b of $$('button')) {
    if(b.closest('nav') || b.dataset.go || b.closest('#install-dialog') || b.dataset.scope) continue;
    const needsSnapshot=!state.snapshot&&!['refresh','check-updates','refresh-log','admin-button','open-data'].includes(b.id);
    b.disabled=isBusy()||b.dataset.locked==='true'||needsSnapshot;
  }
}
async function task(callback) {
  if(isBusy()) return;
  state.localBusy=true; updateBusy(); notice('');
  try { return await callback(); }
  catch(error) { if(error.message !== 'Cancelled.') notice(error.message,true); }
  finally { state.localBusy=false; updateBusy(); if(!state.busy) $('#operation-status').textContent='Ready'; }
}
async function loadSnapshot(resetDrafts=true) {
  state.snapshot=await api.invoke('snapshot');
  if(resetDrafts) for(const scope of ['User','Machine']) state.drafts[scope]=pathEntries(state.snapshot[scope.toLowerCase()+'Path']);
  render();
}
function render() {
  const s=state.snapshot; if(!s) return;
  $('#nav-count').textContent=s.installations.length;
  $('#installed-count').textContent=String(s.installations.length).padStart(2,'0');
  const active=s.installations.find(i=>i.active);
  $('#active-version').textContent=active?.version || 'No match';
  $('#active-description').textContent=active ? `Saved ${active.inMachinePath?'Machine':'User'} PATH · first Node.js match` : 'Add an installed version to PATH';
  $('#update-count').textContent=state.catalog ? String(s.installations.filter(i=>i.latest && compare(i.latest,i.version)>0).length).padStart(2,'0') : '—';
  $('#list-count').textContent=s.installations.length;
  $('#permission').textContent=s.demo?'Preview · sample data':s.admin?'Administrator':'User access';
  $('#admin-button').classList.toggle('hidden',s.admin);
  $('#platform-status').textContent=`Windows · ${s.architecture} · ${s.demo?'Preview mode':'Local environment'}`;
  renderVersions(); renderPath(); renderChocolatey(); updateBusy();
}
function compare(a,b) { const av=a.replace(/^v/,'').split('.').map(Number),bv=b.replace(/^v/,'').split('.').map(Number); return av[0]-bv[0]||av[1]-bv[1]||av[2]-bv[2]; }
function renderVersions() {
  if(!state.snapshot) return;
  const query=$('#search').value.toLowerCase(), filter=$('#version-filter').value;
  const items=state.snapshot.installations.filter(i=>(`${i.version} ${i.directory} ${i.source}`.toLowerCase().includes(query)) && (filter==='all'||filter==='updates'&&i.latest&&compare(i.latest,i.version)>0||filter==='path'&&i.pathPosition!==null||filter==='managed'&&i.managed));
  const list=$('#version-list'); list.replaceChildren();
  if(!items.length) {
    const empty=el('div','empty'); empty.append(el('h2','',state.snapshot.installations.length?'No matching versions':'A clean slate for your next project.'),el('p','',state.snapshot.installations.length?'Try another search or filter.':'Install your first runtime, or add a folder containing an existing node.exe.'));
    if(!state.snapshot.installations.length) empty.append(button('＋ Install a version',openInstall,'button primary'));
    list.append(empty); updateBusy(); return;
  }
  for(const item of items) {
    const card=el('article',`version-card${item.active?' active':''}`), top=el('div','version-top'), identity=el('div','version-identity');
    identity.append(el('span','node-icon','⬡'),el('span','version-number',item.version));
    const release=state.catalog?.releases.find(r=>r.version===item.version);
    if(release?.lts) identity.append(el('span','version-major-label',`${release.lts} LTS`));
    if(item.active) identity.append(el('span','badge green','● Active in PATH'));
    else if(item.pathPosition!==null) identity.append(el('span','badge','In PATH'));
    top.append(identity);
    const actions=el('div','version-actions');
    actions.append(button(item.pathPosition!==null?'Edit PATH':'Add to PATH',()=>addToPath(item), 'button'));
    const canRemove=item.managed||item.source==='Chocolatey'||item.productCode&&item.source==='Detected';
    const removeBlocked=item.inMachinePath||item.inUserPath||item.running;
    actions.append(button('Uninstall',()=>mutate('uninstall',{directory:item.directory},'Version uninstalled.'),'button danger',!canRemove||removeBlocked,!canRemove?`Managed by ${item.source}; use its original version manager to uninstall.`:removeBlocked?'Remove this version from PATH and stop its running processes before uninstalling.':'Remove this installation'));
    top.append(actions); card.append(top,el('div','directory',item.directory));
    const meta=el('div','version-meta');
    for(const [label,value] of [['Installed',date(item.installed)+(item.installDateEstimated?' (estimated)':'')],['Last observed use',date(item.lastUsed)],['Source',item.source]]) { const span=el('span','',label); span.append(el('b','',value)); meta.append(span); }
    card.append(meta);
    if(item.latest&&compare(item.latest,item.version)>0) {
      const update=el('div','version-update');update.append(el('span','',`↗ ${item.latest} available in v${item.version.split('.')[0].slice(1)} · same major release`),button('Install update alongside →',()=>installVersion(item.latest),'text-button'));card.append(update);
    }
    list.append(card);
  }
  updateBusy();
}
function switchPage(page) {
  state.page=page;
  for(const p of $$('.page')) p.classList.toggle('hidden',p.id!==page+'-page');
  for(const b of $$('[data-page]')) b.classList.toggle('selected',b.dataset.page===page);
  $('#breadcrumb').textContent=labels[page];
  if(page==='activity') loadLog();
}
function dirty(scope=state.scope) { return state.drafts[scope].join(';') !== state.snapshot?.[scope.toLowerCase()+'Path']; }
function addToPath(item) {
  if(item.pathPosition!==null) state.scope=item.inMachinePath?'Machine':'User';
  else {
    if(!state.snapshot.admin)state.scope='User';
    if(!state.drafts[state.scope].some(p=>samePath(p,item.directory))) state.drafts[state.scope].unshift(item.directory);
  }
  switchPage('path');renderPath();
}
function renderPath() {
  if(!state.snapshot) return;
  const list=$('#path-list');list.replaceChildren();
  const entries=state.drafts[state.scope];
  for(const b of $$('[data-scope]')) b.classList.toggle('selected',b.dataset.scope===state.scope);
  entries.forEach((value,index)=>{
    const row=el('div','path-row'),text=el('div','path-value',value||'(empty entry preserved)');
    const installation=state.snapshot.installations.find(i=>samePath(i.directory,value));
    if(installation) text.append(el('small','',`${installation.version} · ${installation.source}`));
    const move=delta=>{[entries[index],entries[index+delta]]=[entries[index+delta],entries[index]];renderPath();};
    row.append(el('span','index',String(index+1).padStart(2,'0')),text,button('↑',()=>move(-1),'icon-button',index===0,'Move up'),button('↓',()=>move(1),'icon-button',index===entries.length-1,'Move down'),button('×',()=>{entries.splice(index,1);renderPath();},'icon-button',false,'Remove PATH entry'));
    list.append(row);
  });
  if(!entries.length) list.append(el('div','empty','This PATH scope has no entries. Add an installed version below.'));
  $('#path-dirty').textContent=dirty()?'Unsaved changes':'No unsaved changes';
  $('#path-permission').textContent=state.scope==='User'?'Changes affect your Windows user account.':state.snapshot.admin?'Changes affect every user on this computer.':'Administrator access is required to save Machine PATH.';
  lockButton($('#save-path'),!dirty()||state.scope==='Machine'&&!state.snapshot.admin);
  const select=$('#path-installation');select.replaceChildren();
  for(const i of state.snapshot.installations) { const option=el('option','',`${i.version} — ${i.directory}`);option.value=i.directory;select.append(option); }
  lockButton($('#path-add'),!state.snapshot.installations.length);
  updateBusy();
}
function renderChocolatey() {
  const s=state.snapshot;if(!s) return;
  $('#choco-status').textContent=s.chocoInstalled?'● Chocolatey installed':'Chocolatey not installed';
  $('#choco-status').classList.toggle('green',s.chocoInstalled);
  $('#choco-setup').classList.toggle('hidden',s.chocoInstalled);
  const list=$('#choco-packages');list.replaceChildren();
  const descriptions={'nodejs-lts':'Latest long-term support release. A steady choice for most projects.','nodejs.install':'Windows Installer package for the current Node.js release.','nodejs':'Node.js meta-package. Pulls in the installer as a dependency.'};
  for(const name of ['nodejs-lts','nodejs.install','nodejs']) {
    const item=s.packages.find(p=>p.name===name),card=el('article','package-card');
    card.append(el('h2','',name),el('span',item?'badge green':'badge',item?'v'+item.version:'Not installed'),el('p','',descriptions[name]));
    const actions=el('div','package-actions');
    const disabled=!s.admin||!s.chocoInstalled;
    actions.append(button(item?'Upgrade':'Install',()=>choco(item?'upgrade':'install',name),'button',disabled,'Administrator access required'));
    if(item) actions.append(button('Uninstall',()=>choco('uninstall',name),'button danger',disabled));
    card.append(actions);list.append(card);
  }
  lockButton($('#choco-specific'),!s.admin||!s.chocoInstalled);
  lockButton($('#setup-choco'),!s.admin);
  if(s.chocoError) list.append(el('p','muted',`Chocolatey inventory could not be read: ${s.chocoError}`));
  updateBusy();
}
async function loadCatalog() {
  state.catalog=await api.invoke('catalog');
  $('#catalog-status').textContent=`${state.catalog.offline?'Offline · cached releases':'nodejs.org · release catalog checked'} ${date(state.catalog.date)}${state.snapshot?.demo?' · Sample data':''}`;
  if(state.catalog.offline) notice('Using cached release data. Latest versions may have changed. '+state.catalog.warning);
  if(state.snapshot) for(const i of state.snapshot.installations) i.latest=state.catalog.releases.filter(r=>r.version.split('.')[0]===i.version.split('.')[0]).sort((a,b)=>compare(b.version,a.version))[0]?.version||null;
  render();
}
async function refresh() {
  if((dirty('User')||dirty('Machine')) && !window.confirm('Refresh will discard unsaved PATH changes. Continue?')) return;
  await loadSnapshot();
  if(state.catalog) { for(const i of state.snapshot.installations) i.latest=state.catalog.releases.filter(r=>r.version.split('.')[0]===i.version.split('.')[0]).sort((a,b)=>compare(b.version,a.version))[0]?.version||null;render(); }
}
async function mutate(action,payload,message) {
  return task(async()=>{ const result=await api.invoke(action,payload);await loadSnapshot();if(state.catalog) {for(const i of state.snapshot.installations)i.latest=state.catalog.releases.filter(r=>r.version.split('.')[0]===i.version.split('.')[0]).sort((a,b)=>compare(b.version,a.version))[0]?.version||null;render();}notice(message+(result?.rebootRequired?' Restart Windows to complete this operation.':'')); });
}
function populateReleases() {
  const select=$('#release-select');select.replaceChildren();
  const arch=state.snapshot?.architecture==='arm64'?'arm64':'x64';
  const majors=new Set();
  for(const release of state.catalog?.releases || []) {
    if(majors.has(release.version.split('.')[0])||!release.files.includes(`win-${arch}-zip`)) continue;
    majors.add(release.version.split('.')[0]);
    const option=el('option','',`${release.version} · ${release.lts?release.lts+' LTS':'Current / historical'} · ${release.date}`);option.value=release.version;select.append(option);
    if(majors.size>=12) break;
  }
  if(!select.options.length){const o=el('option','','Enter an exact version below');o.value='';select.append(o);}
}
function openInstall() { if(isBusy())return;populateReleases();$('#custom-version').value='';$('#install-dialog').showModal(); }
async function installVersion(version) {
  if(!/^v?\d+\.\d+\.\d+$/.test(version||'')){notice('Enter a stable version such as 24.11.0.',true);return;}
  $('#install-dialog').close();
  await mutate('install',{version},`Installed ${version}. Add it to PATH when you’re ready.`);
}
async function choco(action,name,version) { await mutate('choco',{action,name,version},'Chocolatey operation complete. Refresh existing terminals to see changes.'); }
async function loadLog() {try{$('#activity-log').textContent=await api.invoke('logs');}catch(error){notice(error.message,true);} }
for(const b of $$('[data-page]')) b.addEventListener('click',()=>switchPage(b.dataset.page));
for(const b of $$('[data-go]')) b.addEventListener('click',()=>switchPage(b.dataset.go));
for(const b of $$('[data-scope]')) b.addEventListener('click',()=>{state.scope=b.dataset.scope;renderPath();});
$('#search').addEventListener('input',renderVersions);$('#version-filter').addEventListener('change',renderVersions);
$('#refresh').addEventListener('click',()=>task(refresh));
$('#check-updates').addEventListener('click',()=>task(loadCatalog));
$('#open-install').addEventListener('click',openInstall);
$('#install-selected').addEventListener('click',()=>installVersion($('#custom-version').value.trim()||$('#release-select').value));
$('#add-folder').addEventListener('click',()=>task(async()=>{await api.invoke('folder');await loadSnapshot();}));
$('#path-add').addEventListener('click',()=>{const directory=$('#path-installation').value;if(directory&&!state.drafts[state.scope].some(p=>samePath(p,directory)))state.drafts[state.scope].push(directory);renderPath();});
$('#discard-path').addEventListener('click',()=>{state.drafts[state.scope]=pathEntries(state.snapshot[state.scope.toLowerCase()+'Path']);renderPath();});
$('#save-path').addEventListener('click',()=>mutate('savePath',{scope:state.scope,entries:[...state.drafts[state.scope]],expected:state.snapshot[state.scope.toLowerCase()+'Path']},'PATH saved with a backup. Open a new terminal to use it.'));
$('#restore-path').addEventListener('click',()=>mutate('restorePath',{},'Previous PATH restored. Open a new terminal to use it.'));
$('#admin-button').addEventListener('click',()=>task(()=>api.invoke('admin')));
$('#setup-choco').addEventListener('click',()=>mutate('setupChoco',{},'Chocolatey is ready.'));
$('#choco-specific').addEventListener('click',()=>{const v=$('#choco-version').value.trim();if(!/^\d+\.\d+\.\d+$/.test(v)){notice('Enter an exact version such as 24.11.0.',true);return;}choco('install',$('#choco-package').value,v);});
$('#open-data').addEventListener('click',()=>task(()=>api.invoke('openData')));
$('#refresh-log').addEventListener('click',loadLog);
api.onEvent(event=>{
  if(event.type==='busy')state.busy=true;
  if(event.type==='idle')state.busy=false;
  if(event.type==='progress'||event.type==='busy')$('#operation-status').textContent=event.message;
  if(event.type==='idle')$('#operation-status').textContent='Ready';
  if(event.type==='log'&&state.page==='activity'){const log=$('#activity-log');log.textContent=(log.textContent+'\n'+event.message).slice(-80000);log.scrollTop=log.scrollHeight;}
  updateBusy();
});
window.addEventListener('beforeunload',event=>{if(!isBusy()&&(dirty('User')||dirty('Machine'))){event.preventDefault();event.returnValue='Unsaved PATH changes';}});
task(async()=>{await loadSnapshot();await loadCatalog();});
