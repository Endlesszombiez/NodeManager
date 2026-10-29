const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
function walk(dir) {
  return fs.readdirSync(dir, {withFileTypes:true}).flatMap(entry => entry.isDirectory() ? walk(path.join(dir,entry.name)) : [path.join(dir,entry.name)]);
}
for(const file of [...walk('src'),...walk('scripts'),...walk('tests')].filter(f => /\.(cjs|js)$/.test(f))) {
  const result = spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  if(result.status !== 0) { process.stderr.write(result.stderr); process.exit(1); }
}
for(const file of [...walk('src'),...walk('scripts'),...walk('tests'),...walk('installer'),'package.json','.gitignore','LICENSE','README.md'].filter(f=>fs.existsSync(f)&&!f.endsWith('.ico'))) {
  if(/(?<!\r)\n/.test(fs.readFileSync(file,'utf8'))) throw new Error(`${file} has LF-only line separators; this project requires CRLF for new files.`);
}
console.log('JavaScript syntax and project CRLF checks passed.');
