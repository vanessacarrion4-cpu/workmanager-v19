// ─────────────────────────────────────────────────────────────────────────────
// Avisos (B1): contenedor visual. Se suscribe al bus (toast.ts) y pinta la pila.
// Posición: esquina inferior DERECHA, por encima de la StickyActionBar. El DiagPanel
// vive abajo-izquierda, así que no colisionan. La posición exacta la valida la usuaria.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { Toast, getToasts, subscribeToasts, dismiss } from './toast';

const COLORS: Record<Toast['type'], { bar: string; bg: string; fg: string }> = {
  error: { bar: '#DC2626', bg: '#FEF2F2', fg: '#7F1D1D' },
  warn: { bar: '#D97706', bg: '#FFFBEB', fg: '#78350F' },
  success: { bar: '#059669', bg: '#ECFDF5', fg: '#065F46' },
};

export function ToastContainer() {
  const [items, setItems] = useState<Toast[]>(getToasts());
  useEffect(() => subscribeToasts(() => setItems([...getToasts()])), []);

  if (items.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed', right: 16, bottom: 88, zIndex: 2147483646,
        display: 'flex', flexDirection: 'column', gap: 8,
        width: 340, maxWidth: '92vw',
        pointerEvents: 'none', // el hueco entre avisos no bloquea la app
      }}
    >
      {items.map(t => {
        const c = COLORS[t.type];
        const text = t.render(t.count);
        return (
          <div
            key={t.id}
            style={{
              pointerEvents: 'auto',
              background: c.bg, color: c.fg,
              borderLeft: `4px solid ${c.bar}`, borderRadius: 8,
              padding: '10px 12px', boxShadow: '0 6px 20px rgba(0,0,0,.18)',
              fontSize: 13, lineHeight: 1.4,
              display: 'flex', gap: 10, alignItems: 'flex-start',
            }}
            role="status"
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>
                {text}{t.count > 1 ? ` (×${t.count})` : ''}
              </div>
              {t.detail && (
                <div style={{ marginTop: 2, fontSize: 12, opacity: 0.85 }}>{t.detail}</div>
              )}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Cerrar aviso"
              style={{ background: 'transparent', border: 0, color: c.fg, cursor: 'pointer', fontSize: 16, lineHeight: 1, opacity: 0.7 }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
