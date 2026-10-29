const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Readable, Transform } = require('node:stream');
const { createWriteStream } = require('node:fs');
const { parseVersion, compareVersions, latestInMajor, normalizePath, splitPath, isManagedDirectory } = require('./model.cjs');
const win = require('./windows.cjs');
const RELEASE_URL = 'https://nodejs.org/dist/index.json';
const PACKAGES = ['nodejs', 'nodejs.install', 'nodejs-lts'];
async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error(`Cannot read ${file}: ${error.message}`); }
}
async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2));
  await fs.rename(temporary, file);
}
class Manager {
  constructor(dataDir, emit = () => {}) {
    this.dataDir = dataDir;
    this.root = path.join(dataDir, 'versions');
    this.emit = emit;
    this.busy = false;
    this.releases = [];
    this.catalogDate = null;
  }
  async exclusive(label, callback) {
    if (this.busy) throw new Error('Another operation is running. Wait for it to finish.');
    this.busy = true;
    this.emit({ type: 'busy', message: label });
    try { await this.log(label); const result = await callback(); await this.log(`${label}: complete`); return result; }
    catch (error) { await this.log(`${label}: ${error.message}`).catch(() => {}); throw error; }
    finally { this.busy = false; this.emit({ type: 'idle' }); }
  }
  async log(message) {
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.appendFile(path.join(this.dataDir, 'activity.log'), `${new Date().toISOString()}  ${message}\r\n`);
    this.emit({ type: 'log', message });
  }
  async catalog() {
    try {
      const response = await fetch(RELEASE_URL, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`Node.js server returned ${response.status}`);
      const releases = await response.json();
      if (!Array.isArray(releases) || releases.length === 0 || releases.some(r => !/^v\d+\.\d+\.\d+$/.test(r.version) || !Array.isArray(r.files))) throw new Error('Invalid release catalog.');
      this.releases = releases;
      this.catalogDate = new Date().toISOString();
      await writeJson(path.join(this.dataDir, 'catalog.json'), { releases, date: this.catalogDate });
      return { releases, date: this.catalogDate, offline: false };
    } catch (error) {
      const cached = await readJson(path.join(this.dataDir, 'catalog.json'), null);
      if (!cached) throw new Error(`Cannot check releases: ${error.message}. Installed versions and PATH still work.`);
      this.releases = cached.releases; this.catalogDate = cached.date;
      return { ...cached, offline: true, warning: error.message };
    }
  }
  chocoPath() {
    return path.join(process.env.ChocolateyInstall || path.join(process.env.ProgramData || 'C:\\ProgramData', 'chocolatey'), 'bin', 'choco.exe');
  }
  async chocoPackages() {
    const executable = this.chocoPath();
    if (!await exists(executable)) return [];
    const result = await win.run(executable, ['list', '--limit-output', '--no-color']);
    if (result.code !== 0) throw new Error(result.errors || result.output || 'Chocolatey inventory failed.');
    return result.output.split(/\r?\n/).map(line => line.split('|')).filter(([name, version]) => PACKAGES.includes(name) && version).map(([name, version]) => ({ name, version }));
  }
  async discover() {
    const facts = await win.facts();
    const state = await readJson(path.join(this.dataDir, 'state.json'), { folders: [], observed: {} });
    const directories = new Map();
    const add = (directory, source = 'Detected') => {
      if (!directory) return;
      const expanded = win.expandEnv(directory.replace(/^"|"$/g, ''));
      if (!path.win32.isAbsolute(expanded)) return;
      const key = normalizePath(expanded);
      if (!directories.has(key)) directories.set(key, { directory: expanded, source });
    };
    const scan = async (parent, source, nested = false) => {
      if (!parent) return;
      try {
        for (const entry of await fs.readdir(parent, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          add(path.join(parent, entry.name), source);
          if (nested) add(path.join(parent, entry.name, 'installation'), source);
        }
      } catch (error) { if (!['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) throw error; }
    };
    await scan(this.root, 'Node Manager');
    for (const folder of state.folders) add(folder, 'Added folder');
    for (const entry of splitPath(facts.machinePath || '')) add(entry);
    for (const entry of splitPath(facts.userPath || '')) add(entry);
    for (const entry of splitPath(process.env.PATH || '')) add(entry, 'Session PATH');
    add(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs'));
    add(path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'nodejs'));
    add(process.env.NVM_SYMLINK, 'nvm');
    await scan(process.env.NVM_HOME || path.join(process.env.APPDATA || '', 'nvm'), 'nvm');
    await scan(path.join(process.env.APPDATA || '', 'fnm', 'node-versions'), 'fnm', true);
    await scan(path.join(process.env.LOCALAPPDATA || '', 'fnm', 'node-versions'), 'fnm', true);
    await scan(path.join(process.env.VOLTA_HOME || path.join(process.env.LOCALAPPDATA || '', 'Volta'), 'tools', 'image', 'node'), 'Volta');
    for (const app of facts.apps) add(app.InstallLocation);
    let packages = [], chocoError = null;
    try { packages = await this.chocoPackages(); } catch (error) { chocoError = error.message; }
    const machine = win.resolveEntries(facts.machinePath), user = win.resolveEntries(facts.userPath);
    const effective = [...machine, ...user];
    const running = facts.running.map(normalizePath);
    const installations = [];
    // Deliberately bounded: only known locations and direct PATH folders, never a drive scan.
    for (const item of directories.values()) {
      const executable = path.join(item.directory, 'node.exe');
      if (!await exists(executable)) continue;
      try {
        const result = await win.run(executable, ['--version'], { timeout: 5000 });
        if (result.code !== 0) throw new Error('node.exe did not exit successfully.');
        const version = result.output.trim();
        parseVersion(version);
        const stat = await fs.stat(executable);
        const managed = isManagedDirectory(this.root, item.directory) && await exists(path.join(item.directory, '.node-manager.json'));
        const manifest = managed ? await readJson(path.join(item.directory, '.node-manager.json'), {}) : {};
        const app = facts.apps.find(a => a.DisplayVersion === version.slice(1) && normalizePath(a.InstallLocation || path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs')) === normalizePath(item.directory));
        const choco = packages.find(p => p.version === version.slice(1) && p.name !== 'nodejs') || null;
        const key = normalizePath(item.directory);
        const position = effective.indexOf(key);
        const observed = running.includes(normalizePath(executable));
        if (observed) state.observed[key] = new Date().toISOString();
        installations.push({ ...item, version, managed, source: managed ? 'Node Manager' : choco && normalizePath(item.directory) === normalizePath(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs')) ? 'Chocolatey' : item.source,
          choco: choco?.name, productCode: app?.WindowsInstaller === 1 && /^\{[\dA-F-]{36}\}$/i.test(app.PSChildName) ? app.PSChildName : null,
          installed: manifest.installed || (/^\d{8}$/.test(app?.InstallDate || '') ? `${app.InstallDate.slice(0,4)}-${app.InstallDate.slice(4,6)}-${app.InstallDate.slice(6,8)}` : stat.birthtime.toISOString()),
          installDateEstimated: !manifest.installed && !/^\d{8}$/.test(app?.InstallDate || ''), lastUsed: state.observed[key] || null, running: observed,
          pathPosition: position < 0 ? null : position, inMachinePath: machine.includes(key), inUserPath: user.includes(key),
          latest: latestInMajor(this.releases, version)?.version || null, size: stat.size });
      } catch (error) { await this.log(`Skipped ${executable}: ${error.message}`); }
    }
    installations.sort((a,b) => compareVersions(b.version, a.version) || a.directory.localeCompare(b.directory));
    const first = installations.filter(i => i.pathPosition !== null).sort((a,b) => a.pathPosition - b.pathPosition)[0];
    for (const item of installations) item.active = item === first;
    await writeJson(path.join(this.dataDir, 'state.json'), state);
    return { installations, userPath: facts.userPath || '', machinePath: facts.machinePath || '', admin: facts.admin, packages, chocoInstalled: await exists(this.chocoPath()), chocoError, root: this.root, dataDir: this.dataDir, architecture: process.arch };
  }
  async addFolder(directory) {
    if (!await exists(path.join(directory, 'node.exe'))) throw new Error('This folder does not contain node.exe.');
    const state = await readJson(path.join(this.dataDir, 'state.json'), { folders: [], observed: {} });
    if (!state.folders.some(p => normalizePath(p) === normalizePath(directory))) state.folders.push(directory);
    await writeJson(path.join(this.dataDir, 'state.json'), state);
  }
  async install(version) {
    parseVersion(version);
    version = 'v' + version.replace(/^v/, '');
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const name = `node-${version}-win-${arch}`;
    const destination = path.join(this.root, `${version}-win-${arch}`);
    if (await exists(destination)) throw new Error('This version is already installed by Node Manager.');
    const staging = path.join(this.dataDir, 'downloads', crypto.randomUUID());
    await fs.mkdir(staging, { recursive: true });
    try {
      const base = `https://nodejs.org/dist/${version}/`;
      const sums = await fetch(base + 'SHASUMS256.txt', { signal: AbortSignal.timeout(30000) });
      if (!sums.ok) throw new Error(`No official download for ${version} (${sums.status}).`);
      const checksum = (await sums.text()).split(/\r?\n/).find(line => line.trim().split(/\s+/)[1] === `${name}.zip`)?.split(/\s+/)[0];
      if (!/^[a-f0-9]{64}$/.test(checksum || '')) throw new Error('Official SHA-256 checksum is missing.');
      const archive = path.join(staging, 'node.zip');
      const response = await fetch(base + `${name}.zip`, { signal: AbortSignal.timeout(600000) });
      if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}).`);
      const hash = crypto.createHash('sha256'); let bytes = 0;
      const total = Number(response.headers.get('content-length'));
      let lastProgress = 0;
      const meter = new Transform({ transform: (chunk, encoding, callback) => {
        bytes += chunk.length;
        if (bytes > 512 * 1024 * 1024) return callback(new Error('Download exceeded the size limit.'));
        hash.update(chunk);
        if (Date.now() - lastProgress > 200) { this.emit({ type: 'progress', message: `Downloading ${version}: ${(bytes / 1048576).toFixed(1)} MB${total ? ' / ' + (total / 1048576).toFixed(1) + ' MB' : ''}` }); lastProgress = Date.now(); }
        callback(null, chunk);
      }});
      await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(archive));
      if (hash.digest('hex') !== checksum) throw new Error('SHA-256 verification failed. Nothing was installed.');
      this.emit({ type: 'progress', message: 'Checksum verified. Extracting…' });
      await win.ps(`Expand-Archive -LiteralPath ${win.psQuote(archive)} -DestinationPath ${win.psQuote(staging)} -Force`, { timeout: 120000 });
      const extracted = path.join(staging, name);
      const check = await win.run(path.join(extracted, 'node.exe'), ['--version']);
      if (check.code !== 0 || check.output !== version) throw new Error('Downloaded executable reported an unexpected version or failed to run.');
      await writeJson(path.join(extracted, '.node-manager.json'), { version, installed: new Date().toISOString(), checksum });
      await fs.mkdir(this.root, { recursive: true });
      await fs.rename(extracted, destination);
      await this.log(`Installed ${version} in ${destination}; SHA-256 ${checksum}`);
      return destination;
    } finally { await fs.rm(staging, { recursive: true, force: true }); }
  }
  async uninstall(directory) {
    const snapshot = await this.discover();
    const item = snapshot.installations.find(i => normalizePath(i.directory) === normalizePath(directory));
    if (!item) throw new Error('Installation no longer exists. Refresh the list.');
    if (item.inMachinePath || item.inUserPath) throw new Error('Remove this version from both PATH scopes before uninstalling.');
    if (item.managed) {
      if (item.running) throw new Error('This Node.js version is running. Stop its processes, then refresh before uninstalling.');
      if (!isManagedDirectory(this.root, directory)) throw new Error('Refusing to remove a directory outside the managed versions folder.');
      const realRoot = await fs.realpath(this.root), realDirectory = await fs.realpath(directory);
      if (!isManagedDirectory(realRoot, realDirectory) || (await fs.lstat(directory)).isSymbolicLink()) throw new Error('Refusing to remove a linked installation.');
      await fs.rm(directory, { recursive: true });
    } else if (item.source === 'Chocolatey' && item.choco) {
      await this.chocolatey('uninstall', item.choco);
    } else if (item.productCode && item.source === 'Detected') {
      if (!snapshot.admin) throw new Error('Restart as administrator to uninstall a Windows Installer package.');
      const result = await win.run(path.join(process.env.SystemRoot, 'System32', 'msiexec.exe'), ['/x', item.productCode, '/passive', '/norestart'], { timeout: 600000, onOutput: message => this.emit({type:'log',message}) });
      if (![0, 1641, 3010].includes(result.code)) throw new Error(`Windows Installer returned ${result.code}.`);
    } else throw new Error(`This installation is owned by ${item.source}. Remove it using its original installer or version manager.`);
  }
  async chocolatey(action, name, version) {
    if (!['install', 'upgrade', 'uninstall'].includes(action) || !PACKAGES.includes(name)) throw new Error('Unsupported Chocolatey action.');
    if (version) parseVersion(version);
    const facts = await win.facts();
    if (!facts.admin) throw new Error('Restart as administrator to change Chocolatey packages.');
    if (!await exists(this.chocoPath())) throw new Error('Chocolatey is not installed. Use Set up Chocolatey first.');
    const args = [action, name, '--yes', '--no-progress', '--limit-output', '--no-color'];
    if (version && action !== 'uninstall') args.push(`--version=${version.replace(/^v/, '')}`);
    const result = await win.run(this.chocoPath(), args, { timeout: 1200000, onOutput: message => this.emit({ type: 'log', message }) });
    await this.log(result.output);
    if (![0, 1641, 3010].includes(result.code)) throw new Error(`Chocolatey exited with ${result.code}: ${result.errors || result.output}`);
    return { rebootRequired: [1641,3010].includes(result.code) };
  }
  async setupChocolatey() {
    const facts = await win.facts();
    if (!facts.admin) throw new Error('Restart as administrator to set up Chocolatey.');
    if (await exists(this.chocoPath())) return;
    await win.ps("[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Set-ExecutionPolicy Bypass -Scope Process -Force; Invoke-Expression ((New-Object Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))", { timeout: 600000, onOutput: message => this.emit({ type:'log', message }) });
    if (!await exists(this.chocoPath())) throw new Error('Chocolatey setup finished without creating choco.exe. See the activity log.');
  }
  async restorePath() {
    const directory = path.join(this.dataDir, 'path-backups');
    const files = (await fs.readdir(directory)).filter(f => /^\d+\.json$/.test(f)).sort().reverse();
    if (!files.length) throw new Error('No PATH backup is available.');
    const backup = await readJson(path.join(directory, files[0]));
    await win.savePath(backup.scope, splitPath(backup.value), backup.saved, this.dataDir);
    return backup.scope;
  }
}
module.exports = { Manager, PACKAGES };
