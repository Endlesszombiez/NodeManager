const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { Manager } = require('./core/manager.cjs');
const win = require('./core/windows.cjs');
let window, manager;
const demo = process.argv.includes('--demo');
if (!app.isPackaged && process.env.NODE_MANAGER_TEST_DATA) app.setPath('userData', process.env.NODE_MANAGER_TEST_DATA);
const uiFile = path.join(__dirname, 'ui', 'index.html');
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
async function confirm(title, message, detail) {
  const result = await dialog.showMessageBox(window, { type: 'warning', title, message, detail, buttons: ['Cancel', title], defaultId: 0, cancelId: 0, noLink: true });
  if (result.response !== 1) throw new Error('Cancelled.');
}
function demoSnapshot() {
  return {
    installations: [
      { version:'v24.11.0', directory:'C:\\Users\\you\\AppData\\Roaming\\Node Manager\\versions\\v24.11.0-win-x64', source:'Node Manager', managed:true, installed:'2026-10-12', lastUsed:'2026-10-29T12:20:00Z', pathPosition:3, active:true, inUserPath:true, latest:'v24.12.0' },
      { version:'v22.20.0', directory:'C:\\Program Files\\nodejs', source:'Chocolatey', managed:false, installed:'2026-09-18', lastUsed:null, pathPosition:null, latest:'v22.20.0', choco:'nodejs-lts' },
      { version:'v20.19.5', directory:'C:\\Users\\you\\AppData\\Roaming\\nvm\\v20.19.5', source:'nvm', managed:false, installed:'2026-06-04', installDateEstimated:true, lastUsed:null, pathPosition:null, latest:'v20.20.0' }
    ], userPath:'%USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps;C:\\Users\\you\\AppData\\Roaming\\Node Manager\\versions\\v24.11.0-win-x64', machinePath:'C:\\Windows\\system32;C:\\Windows', admin:false, packages:[{name:'nodejs-lts',version:'22.20.0'}], chocoInstalled:true, root:'C:\\Users\\you\\AppData\\Roaming\\Node Manager\\versions', dataDir:'Demo data', architecture:'x64', demo:true
  };
}
async function invoke(action, payload = {}) {
  if (action === 'snapshot') return demo ? demoSnapshot() : manager.exclusive('Scanning installations', () => manager.discover());
  if (action === 'catalog') {
    if (demo) return { date:new Date().toISOString(), releases:[{version:'v26.1.0', date:'2026-10-27', lts:false, files:['win-x64-zip']},{version:'v24.12.0',date:'2026-10-20',lts:'Krypton',files:['win-x64-zip']},{version:'v22.20.0',date:'2026-10-15',lts:'Jod',files:['win-x64-zip']},{version:'v20.20.0',date:'2026-10-10',lts:'Iron',files:['win-x64-zip']}] };
    return manager.exclusive('Checking nodejs.org releases', () => manager.catalog());
  }
  if (action === 'logs') {
    if (demo) return 'Preview mode — sample data. System changes are disabled.';
    try { return (await fs.readFile(path.join(manager.dataDir, 'activity.log'), 'utf8')).slice(-80000); } catch (e) { if (e.code === 'ENOENT') return 'No activity yet.'; throw e; }
  }
  if (demo) throw new Error('Preview mode uses sample data. Restart without --demo to manage this computer.');
  if (action === 'folder') {
    const selected = await dialog.showOpenDialog(window, { title:'Choose a folder containing node.exe', properties:['openDirectory'] });
    if (!selected.canceled) await manager.exclusive('Adding installation folder', () => manager.addFolder(selected.filePaths[0]));
    return !selected.canceled;
  }
  if (action === 'openData') return shell.openPath(manager.dataDir);
  if (action === 'admin') {
    if (manager.busy) throw new Error('Wait for the current operation to finish.');
    await confirm('Restart as administrator', 'Restart Node Manager with administrator access?', 'Windows will show a User Account Control prompt. Your current PATH draft will be discarded.');
    const args = app.isPackaged ? '' : ` -ArgumentList ${win.psQuote('"' + app.getAppPath() + '"')}`;
    app.releaseSingleInstanceLock();
    try { await win.ps(`Start-Process -FilePath ${win.psQuote(process.execPath)}${args} -Verb RunAs -WindowStyle Hidden`); }
    catch (error) { app.requestSingleInstanceLock(); throw error; }
    window.destroy(); app.quit(); return;
  }
  if (action === 'install') {
    await confirm('Install version', `Install Node.js ${payload.version}?`, 'Downloads an official ZIP from nodejs.org, verifies its SHA-256 checksum, and installs it side by side. PATH is unchanged until you save it in the PATH editor.');
    return manager.exclusive(`Installing ${payload.version}`, () => manager.install(payload.version));
  }
  if (action === 'uninstall') {
    await confirm('Uninstall version', 'Remove this Node.js installation?', payload.directory + '\n\nRemove its PATH entries first. Managed files will be deleted; Chocolatey or Windows Installer installations use their own uninstallers.');
    return manager.exclusive('Uninstalling Node.js', () => manager.uninstall(payload.directory));
  }
  if (action === 'savePath') {
    await confirm('Save PATH', `Save ${payload.scope} PATH?`, 'New terminals will use the new PATH order. Existing terminals keep their current environment. A backup is saved before changing PATH.\n\n' + (Array.isArray(payload.entries) ? payload.entries.join('\n') : ''));
    return manager.exclusive('Saving PATH', () => win.savePath(payload.scope, payload.entries, payload.expected, manager.dataDir));
  }
  if (action === 'restorePath') {
    await confirm('Restore PATH', 'Undo the most recent PATH save?', 'Restores the previous PATH only if it has not changed since that save.');
    return manager.exclusive('Restoring PATH', () => manager.restorePath());
  }
  if (action === 'choco') {
    await confirm('Run Chocolatey', `${payload.action} ${payload.name}${payload.version ? ' ' + payload.version : ''}?`, 'Chocolatey runs package scripts as administrator and may replace the shared Node.js installation. Its packages do not provide side-by-side versions. Package dependencies may also change.');
    return manager.exclusive(`Chocolatey ${payload.action} ${payload.name}`, () => manager.chocolatey(payload.action, payload.name, payload.version));
  }
  if (action === 'setupChoco') {
    await confirm('Set up Chocolatey', 'Install Chocolatey on this computer?', 'Downloads and runs the official setup script from https://community.chocolatey.org/install.ps1 as administrator. Chocolatey is a separate package manager with its own terms.');
    return manager.exclusive('Setting up Chocolatey', () => manager.setupChocolatey());
  }
  throw new Error('Unknown action.');
}
app.whenReady().then(() => {
  app.setAppUserModelId('dev.nodemanager.desktop');
  manager = new Manager(app.getPath('userData'), event => { if (window && !window.isDestroyed()) window.webContents.send('manager:event', event); });
  ipcMain.handle('manager:invoke', async (event, action, payload) => {
    if (event.sender !== window.webContents || event.senderFrame.url !== pathToFileURL(uiFile).href) throw new Error('Untrusted request.');
    try { return { ok:true, value:await invoke(action, payload) }; }
    catch (error) { return { ok:false, error:error.message }; }
  });
  window = new BrowserWindow({ width:1260, height:850, minWidth:1000, minHeight:700, backgroundColor:'#101411', title:'Node Manager', autoHideMenuBar:true,
    webPreferences:{ preload:path.join(__dirname,'preload.cjs'), contextIsolation:true, nodeIntegration:false, sandbox:true, spellcheck:false } });
  window.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-prevent-unload', event => {
    const response = dialog.showMessageBoxSync(window, { type:'question', message:'Discard unsaved PATH changes and close?', buttons:['Keep editing','Discard and close'], defaultId:0, cancelId:0 });
    if (response === 1) event.preventDefault();
  });
  window.on('close', event => { if (manager.busy) { event.preventDefault(); dialog.showMessageBox(window, {type:'info',message:'An operation is still running. Please wait before closing Node Manager.'}); } });
  window.loadFile(uiFile);
});
app.on('window-all-closed', () => app.quit());
