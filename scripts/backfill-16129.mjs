// backfill-16129.mjs — reescribe la NOTA del cierre de los días ya guardados con la fórmula nueva (§16.129:
// crédito por tarea con tope = su estimación). Lee un payload YA CALCULADO con el código real de filters.ts
// (no reimplementa la fórmula aquí: una sola fuente de verdad).
//
// Uso:  node scripts/backfill-16129.mjs <payload.json> [--escribir]
//       sin --escribir hace SIMULACRO (imprime lo que haría y no toca nada).
//
// Qué escribe, por día:
//   · modo 'detalle-propio' (días con frozen.taskDetail): frozen.score, frozen.barras y frozen.taskDetail
//     (este último solo cambia el `fichado` de las filas afectadas por el doble conteo contenedor/hoja).
//   · modo 'reconstruido' (días sin detalle, anteriores al §16.127): SOLO frozen.score + marca de procedencia.
//     Sus barras y su detalle NO se tocan: las tareas nuevas de aquellos días no se pueden reconstruir con
//     fidelidad (el congelado de entonces no guarda ids).
// Todo lo demás del reporte (veredicto, causas, entrada, decisiones, nota escrita) se conserva intacto.
// Antes de correrlo hay una exportación completa en backups/backfill-16129/.
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
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const payloadPath = process.argv[2];
const ESCRIBIR = process.argv.includes('--escribir');
if (!payloadPath) { console.error('Falta la ruta del payload'); process.exit(1); }
const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));

const get = async (u) => { const r = await fetch(`${URL}/rest/v1/${u}`, { headers: H }); const j = await r.json(); if (!Array.isArray(j)) throw new Error(JSON.stringify(j).slice(0, 300)); return j; };

let cambios = 0;
for (const [date, p] of Object.entries(payload)) {
  const rows = await get(`day_reports?select=date,measures&date=eq.${date}`);
  if (!rows.length) { console.log(`${date}  · SIN REPORTE, se salta`); continue; }
  const measures = rows[0].measures || {};
  const frozen = measures.frozen || {};
  const viejo = frozen.score?.notaPonderada;
  // el 'estimé bien' es informativo y salía del deviation congelado: se conserva tal cual.
  const score = { ...p.score, estimoBien: frozen.score?.estimoBien ?? p.score.estimoBien };
  const nuevoFrozen = { ...frozen, score };
  if (p.modo === 'detalle-propio') {
    nuevoFrozen.barras = p.barras;
    nuevoFrozen.taskDetail = p.taskDetail;
  } else {
    nuevoFrozen.scoreOrigen = { formula: '16.129', modo: 'reconstruido', desde: 'plan congelado + libro de time_entries + cumplidas congeladas', fecha: new Date().toISOString() };
  }
  const nuevasMeasures = {
    ...measures,
    frozen: nuevoFrozen,
    // §16.129: rastro de lo que había antes, por si hay que volver atrás sin ir al backup.
    scorePrevio16127: measures.scorePrevio16127 ?? (frozen.score ?? null),
  };
  console.log(`${date}  ${p.modo.padEnd(15)} nota ${String(viejo ?? '—').padStart(4)} → ${score.notaPonderada}   (plan ${score.cumpliPlan.pct}% · core ${score.protegiCore.pct}%)${ESCRIBIR ? '' : '   [simulacro]'}`);
  if (!ESCRIBIR) continue;
  const r = await fetch(`${URL}/rest/v1/day_reports?date=eq.${date}`, {
    method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify({ measures: nuevasMeasures, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) { console.error(`  ✗ ERROR escribiendo ${date}: ${r.status} ${await r.text()}`); process.exit(1); }
  cambios++;
}
console.log(ESCRIBIR ? `\nEscritos ${cambios} reportes.` : `\nSIMULACRO: nada escrito. Repite con --escribir.`);
