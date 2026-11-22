// "Build" del proyecto: verifica sintaxis de todo el JS y que existan los artefactos que Vercel publica.
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const roots = ['api', 'lib', 'public', 'scripts', 'test'];
const files = [];
const walk = (p) => statSync(p).isDirectory() ? readdirSync(p).forEach((f) => walk(path.join(p, f))) : p.endsWith('.js') && files.push(p);
roots.forEach(walk);
for (const f of files) execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });
for (const req of ['public/index.html', 'db/schema.sql', 'db/seed.sql', 'vercel.json']) {
  if (!existsSync(req)) { console.error(`Falta ${req}`); process.exit(1); }
}
console.log(`Build OK: ${files.length} archivos JS verificados, artefactos estáticos y SQL presentes.`);
