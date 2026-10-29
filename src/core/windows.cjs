const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { normalizePath, splitPath, validateEntries, assertUnchanged } = require('./model.cjs');
const psQuote = value => "'" + String(value).replaceAll("'", "''") + "'";
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
function run(file, args, { timeout = 30000, onOutput } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, shell: false });
    let output = '', errors = '', done = false;
    const timer = setTimeout(() => { child.kill(); finish(new Error('Operation timed out. Refresh to check its result.')); }, timeout);
    function finish(error, result) { if (done) return; done = true; clearTimeout(timer); error ? reject(error) : resolve(result); }
    child.stdout.on('data', b => { output += b; onOutput?.(String(b)); });
    child.stderr.on('data', b => { errors += b; onOutput?.(String(b)); });
    child.on('error', error => finish(error));
    child.on('close', code => finish(null, { code, output: output.trim(), errors: errors.trim() }));
  });
}
async function ps(script, options) {
  const encoded = Buffer.from("$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; " + script, 'utf16le').toString('base64');
  const result = await run(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], options);
  if (result.code !== 0) throw new Error(result.errors || result.output || `PowerShell exited with ${result.code}`);
  return result.output;
}
async function facts() {
  return JSON.parse(await ps(`
    $admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    $apps=@(Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match '^Node\\.js' } | Select-Object DisplayName,DisplayVersion,InstallLocation,InstallDate,PSChildName,WindowsInstaller)
    $running=@(Get-CimInstance Win32_Process -Filter "name = 'node.exe'" -ErrorAction SilentlyContinue | Where-Object ExecutablePath | Select-Object -ExpandProperty ExecutablePath)
    [pscustomobject]@{admin=$admin;userPath=[Environment]::GetEnvironmentVariable('Path','User');machinePath=[Environment]::GetEnvironmentVariable('Path','Machine');apps=$apps;running=$running} | ConvertTo-Json -Depth 5 -Compress
  `));
}
async function savePath(scope, entries, expected, dataDir, execute = ps) {
  if (!['User', 'Machine'].includes(scope)) throw new Error('Invalid PATH scope.');
  validateEntries(entries, true);
  const readPath = async target => JSON.parse(await execute(`[Environment]::GetEnvironmentVariable('Path',${psQuote(target)}) | ConvertTo-Json -Compress`)) || '';
  const current = await readPath(scope);
  assertUnchanged(current, expected);
  await fs.mkdir(path.join(dataDir, 'path-backups'), { recursive: true });
  const backup = { scope, value: current, saved: entries.join(';'), date: new Date().toISOString() };
  await fs.writeFile(path.join(dataDir, 'path-backups', `${Date.now()}.json`), JSON.stringify(backup, null, 2));
  await execute(`
    $scope=${psQuote(scope)}; $expected=${psQuote(expected)}
    $current=[Environment]::GetEnvironmentVariable('Path',$scope); if ($null -eq $current) { $current='' }
    if ($current -cne $expected) { throw 'PATH changed externally. Refresh before saving.' }
    [Environment]::SetEnvironmentVariable('Path',${psQuote(entries.join(';'))},$scope)
    Add-Type -Namespace NM -Name Native -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll", CharSet=System.Runtime.InteropServices.CharSet.Auto)] public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, uint Msg, System.UIntPtr wParam, string lParam, uint flags, uint timeout, out System.UIntPtr result);'
    $result=[UIntPtr]::Zero; [void][NM.Native]::SendMessageTimeout([IntPtr]0xffff,0x1a,[UIntPtr]::Zero,'Environment',2,5000,[ref]$result)
  `);
  process.env.PATH = [scope === 'Machine' ? entries.join(';') : await readPath('Machine'), scope === 'User' ? entries.join(';') : await readPath('User')].map(expandEnv).join(';');
  return backup;
}
function expandEnv(value) { return value.replace(/%([^%]+)%/g, (all, key) => Object.entries(process.env).find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1] || all); }
function resolveEntries(value) { return splitPath(value || '').map(p => normalizePath(expandEnv(p))); }
module.exports = { run, ps, psQuote, facts, savePath, expandEnv, resolveEntries, powershell };
