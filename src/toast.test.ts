import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toast, getToasts, dismiss, __resetToasts } from './toast';

describe('toast bus (B1)', () => {
  beforeEach(() => { __resetToasts(); });

  it('apila avisos distintos', () => {
    toast.error('A');
    toast.error('B');
    expect(getToasts().length).toBe(2);
  });

  it('agrupa por key: 20 fallos = UN aviso con contador 20', () => {
    for (let i = 0; i < 20; i++) toast.error('fallo al guardar', { key: 'bulk-save' });
    const all = getToasts();
    expect(all.length).toBe(1);
    expect(all[0].count).toBe(20);
  });

  it('el texto del aviso agrupado puede depender del contador', () => {
    const msg = (n: number) =>
      n === 1 ? 'No se pudo guardar 1 tarea.' : `No se pudieron guardar ${n} tareas.`;
    toast.error(msg, { key: 'k' });
    toast.error(msg, { key: 'k' });
    const t = getToasts()[0];
    expect(t.render(t.count)).toBe('No se pudieron guardar 2 tareas.');
  });

  it('sin key NO agrupa aunque el mensaje sea igual', () => {
    toast.error('igual');
    toast.error('igual');
    expect(getToasts().length).toBe(2);
  });

  it('error es pegajoso; warn se auto-desvanece pasado su ttl', () => {
    vi.useFakeTimers();
    toast.error('error pegajoso');
    toast.warn('aviso informativo', { ttlMs: 1000 });
    expect(getToasts().length).toBe(2);
    vi.advanceTimersByTime(1100);
    const all = getToasts();
    expect(all.length).toBe(1);
    expect(all[0].type).toBe('error');
    vi.useRealTimers();
  });

  it('dismiss elimina un aviso concreto', () => {
    const id = toast.error('x');
    toast.error('y');
    dismiss(id);
    const all = getToasts();
    expect(all.length).toBe(1);
    expect(all[0].render(1)).toBe('y');
  });
});
