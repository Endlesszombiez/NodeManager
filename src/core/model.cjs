const path = require('node:path');
const versionPattern = /^v?(\d+)\.(\d+)\.(\d+)$/;
function parseVersion(value) {
  const match = versionPattern.exec(String(value));
  if (!match || match[0] !== String(value)) throw new Error('Expected a stable Node.js version, such as 24.11.0.');
  return match.slice(1).map(Number);
}
function compareVersions(a, b) {
  const av = parseVersion(a), bv = parseVersion(b);
  return av[0] - bv[0] || av[1] - bv[1] || av[2] - bv[2];
}
function latestInMajor(releases, version) {
  const major = parseVersion(version)[0];
  return releases.filter(r => versionPattern.test(r.version) && parseVersion(r.version)[0] === major)
    .sort((a, b) => compareVersions(b.version, a.version))[0] || null;
}
function normalizePath(value) {
  return path.win32.normalize(value.trim().replace(/^"|"$/g, '')).replace(/\\+$/, '').toLowerCase();
}
function splitPath(value) { return value ? value.split(';') : []; }
function validateEntries(entries, preserveEmpty = false) {
  if (!Array.isArray(entries) || entries.some(x => typeof x !== 'string' || !preserveEmpty && !x.trim() || /[;\r\n\0]/.test(x)))
    throw new Error('PATH entries must be nonempty directory names without semicolons or line breaks.');
  if (entries.join(';').length > 32000) throw new Error('PATH is too long.');
  return entries;
}
function assertUnchanged(actual, expected) {
  if (actual !== expected) throw new Error('PATH changed outside Node Manager. Refresh and review your changes again.');
}
function isManagedDirectory(root, directory) {
  const relative = path.relative(root, directory);
  return /^v\d+\.\d+\.\d+-win-(x64|arm64)$/.test(relative) && !path.isAbsolute(relative);
}
module.exports = { parseVersion, compareVersions, latestInMajor, normalizePath, splitPath, validateEntries, assertUnchanged, isManagedDirectory };
