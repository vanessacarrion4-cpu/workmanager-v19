// restore-supabase.mjs — RESTAURA desde una copia hecha con backup-supabase.mjs, sin el panel de Supabase.
// Uso:  npm run restore -- backups/AAAA-MM-DD_HHMM
// Hace UPSERT (por PK) de cada tabla: reescribe filas que existan y añade las que falten. NO borra filas
// que hoy existan y no estén en la copia (restauración no destructiva). Para un rollback total tras un
// desastre, primero vacía la tabla desde el panel y luego restaura — pero para recuperar datos perdidos
// el upsert basta y es seguro.
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const dir = process.argv[2];
if (!dir) { console.error('Indica la carpeta:  npm run restore -- backups/AAAA-MM-DD_HHMM'); process.exit(1); }
const backupDir = path.isAbsolute(dir) ? dir : path.join(ROOT, dir);
if (!fs.existsSync(path.join(backupDir, 'manifest.json'))) { console.error(`No hay manifest.json en ${backupDir}`); process.exit(1); }

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/).filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_KEY;
if (!URL || !KEY) { console.error('Falta SUPABASE_URL o SUPABASE_SERVICE_KEY en .env'); process.exit(1); }

const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, 'manifest.json'), 'utf8'));
const tables = Object.keys(manifest.tables);
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' };
const CHUNK = 500;

let totalUp = 0, failed = 0;
for (const table of tables) {
  const file = path.join(backupDir, `${table}.json`);
  if (!fs.existsSync(file)) { console.error(`  ✗ ${table} — falta ${table}.json, salto`); failed++; continue; }
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  try {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const r = await fetch(`${URL}/rest/v1/${table}`, { method: 'POST', headers, body: JSON.stringify(chunk) });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
    }
    totalUp += rows.length;
    console.log(`  ✓ ${table.padEnd(14)} ${rows.length} filas restauradas (upsert)`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${table.padEnd(14)} ${e.message}`);
  }
}
console.log(`\n${totalUp} filas restauradas.${failed ? ` ${failed} tabla(s) con error.` : ''}`);
if (failed) process.exit(1);
