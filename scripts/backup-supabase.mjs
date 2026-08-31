// backup-supabase.mjs — COPIA DE SEGURIDAD manual, gratuita, repetible, sin depender del panel de Supabase.
// Uso:  npm run backup           (crea backups/AAAA-MM-DD_HHMM/ con un .json por tabla + manifest.json)
// Lee SUPABASE_URL + SUPABASE_SERVICE_KEY de .env. NO borra nada, solo lee. Restaurar: ver restore-supabase.mjs.
//
// Pagina de 1000 en 1000 (PostgREST corta a 1000 por defecto): 'tasks' pasa de 1000 filas y sin paginar
// la copia saldría INCOMPLETA — el mismo fallo de truncado que ya nos mordió en los conteos.
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/).filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_KEY;
if (!URL || !KEY) { console.error('Falta SUPABASE_URL o SUPABASE_SERVICE_KEY en .env'); process.exit(1); }

const TABLES = ['work_blocks', 'tasks', 'persons', 'meetings', 'time_entries', 'day_snapshots', 'day_reports', 'settings'];
const PAGE = 1000;
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function fetchAll(table) {
  // Intento paginado con order=id.asc; si la tabla no tiene 'id', reintento sin order (tabla pequeña, una página).
  const tryPaged = async (useOrder) => {
    const rows = [];
    for (let offset = 0; ; offset += PAGE) {
      const order = useOrder ? '&order=id.asc' : '';
      const r = await fetch(`${URL}/rest/v1/${table}?select=*${order}&limit=${PAGE}&offset=${offset}`, { headers });
      if (!r.ok) throw new Error(`${table} HTTP ${r.status}: ${await r.text()}`);
      const batch = await r.json();
      rows.push(...batch);
      if (batch.length < PAGE) break;
    }
    return rows;
  };
  try { return await tryPaged(true); }
  catch (e) {
    // p.ej. 'settings' sin columna id → una sola página sin order
    const r = await fetch(`${URL}/rest/v1/${table}?select=*&limit=${PAGE}`, { headers });
    if (!r.ok) throw new Error(`${table} HTTP ${r.status}: ${await r.text()}`);
    return await r.json();
  }
}

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
const outDir = path.join(ROOT, 'backups', stamp);
fs.mkdirSync(outDir, { recursive: true });

const manifest = { createdAt: now.toISOString(), url: URL, tables: {} };
let totalRows = 0, failed = 0;

for (const table of TABLES) {
  try {
    const rows = await fetchAll(table);
    fs.writeFileSync(path.join(outDir, `${table}.json`), JSON.stringify(rows, null, 2), 'utf8');
    manifest.tables[table] = rows.length;
    totalRows += rows.length;
    console.log(`  ✓ ${table.padEnd(14)} ${rows.length} filas`);
  } catch (e) {
    manifest.tables[table] = `ERROR: ${e.message}`;
    failed++;
    console.error(`  ✗ ${table.padEnd(14)} ${e.message}`);
  }
}

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
console.log(`\nCopia guardada en  backups/${stamp}/  ·  ${totalRows} filas en ${TABLES.length - failed}/${TABLES.length} tablas`);
if (failed) { console.error(`${failed} tabla(s) fallaron — la copia está INCOMPLETA.`); process.exit(1); }
