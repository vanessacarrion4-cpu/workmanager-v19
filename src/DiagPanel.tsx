// ─────────────────────────────────────────────────────────────────────────────
// DIAG-TEMP (sesión 15): panel flotante de diagnóstico. Quitar con el revert del commit.
// Muestra la traza (diag.ts) y permite copiarla sin abrir la consola.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { getDiag, clearDiag, subscribeDiag } from './diag';

const btn: React.CSSProperties = {
  background: '#1F2937', color: '#fff', border: '1px solid #374151',
  borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer',
};

export function DiagPanel() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState(getDiag());
  useEffect(() => subscribeDiag(() => setEntries(getDiag())), []);

  const json = JSON.stringify(entries, null, 2);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      alert('Traza copiada al portapapeles ✔');
    } catch {
      const ta = document.getElementById('diag-json') as HTMLTextAreaElement | null;
      if (ta) { ta.focus(); ta.select(); try { document.execCommand('copy'); } catch { /* noop */ } alert('Traza seleccionada — pulsa Ctrl+C'); }
    }
  };

  return (
    <div style={{ position: 'fixed', left: 12, bottom: 12, zIndex: 2147483647, fontFamily: 'monospace' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ background: '#111827', color: '#fff', border: '1px solid #374151', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,0,0,.4)' }}
      >
        🐞 DIAG ({entries.length})
      </button>
      {open && (
        <div style={{ marginTop: 8, width: 440, maxWidth: '92vw', maxHeight: '62vh', overflow: 'auto', background: '#0B1120', color: '#E5E7EB', border: '1px solid #374151', borderRadius: 10, padding: 10, boxShadow: '0 8px 30px rgba(0,0,0,.5)' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button onClick={copy} style={btn}>Copiar todo</button>
            <button onClick={() => clearDiag()} style={btn}>Limpiar</button>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6B7280', alignSelf: 'center' }}>{entries.length} pasos</span>
          </div>
          <textarea
            id="diag-json"
            readOnly
            value={json}
            style={{ width: '100%', height: 110, background: '#111827', color: '#9CA3AF', border: '1px solid #374151', borderRadius: 6, fontSize: 10, padding: 6 }}
          />
          <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.5 }}>
            {entries.map((e, i) => (
              <div key={i} style={{ borderTop: '1px solid #1F2937', padding: '4px 0' }}>
                <span style={{ color: '#60A5FA' }}>{e.t}</span>{' '}
                <span style={{ color: '#6B7280' }}>(+{e.ms}ms)</span>{' '}
                <b style={{ color: '#34D399' }}>{e.step}</b>
                {e.data !== undefined && (
                  <pre style={{ margin: '2px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#D1D5DB' }}>{JSON.stringify(e.data)}</pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
