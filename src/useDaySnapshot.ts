// useDaySnapshot.ts — TRAMO 1 (FOTO DEL DÍA). Lee/escribe `day_snapshots` (una fila por fijación, con su hora) y la
// jornada configurable (`settings.key='jornada_minutes'`, default 480). La cabecera muestra la ÚLTIMA fijación del día;
// el histórico completo se guarda desde el principio aunque aún no haya pantalla que lo muestre.
import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';

export interface DaySnapshot {
  id: string;
  date: string;
  taken_at: string;
  task_count: number;
  estimated_minutes: number;
  completed_count: number;
  plan_task_ids?: string[]; // ids de las hojas del día EN EL MOMENTO de fijar (el plan). Base de la NOTA (§16.47). Fotos antiguas: sin lista → sin nota.
}

const DEFAULT_JORNADA = 480; // 8h

export function useDaySnapshot(activeDate: string) {
  const [snapshots, setSnapshots] = useState<DaySnapshot[]>([]);
  const [jornada, setJornadaState] = useState<number>(DEFAULT_JORNADA);

  // Fijaciones del día activo (todas; la cabecera usa la última)
  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data } = await supabase
        .from('day_snapshots').select('*').eq('date', activeDate).order('taken_at', { ascending: true });
      if (!cancel) setSnapshots((data as DaySnapshot[]) || []);
    })();
    return () => { cancel = true; };
  }, [activeDate]);

  // §16.119: jornada GLOBAL (default) + overrides POR DÍA (settings 'jornada_por_dia' = {fecha: minutos}). Para medias jornadas.
  const [jornadaGlobal, setJornadaGlobal] = useState<number>(DEFAULT_JORNADA);
  const [jornadaPorDia, setJornadaPorDia] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancel = false;
    (async () => {
      const [g, d] = await Promise.all([
        supabase.from('settings').select('value').eq('key', 'jornada_minutes').maybeSingle(),
        supabase.from('settings').select('value').eq('key', 'jornada_por_dia').maybeSingle(),
      ]);
      if (cancel) return;
      const gv = (g.data as any)?.value; if (gv != null) setJornadaGlobal(Number(gv) || DEFAULT_JORNADA);
      const dv = (d.data as any)?.value; if (dv && typeof dv === 'object') setJornadaPorDia(dv);
    })();
    return () => { cancel = true; };
  }, []);
  // la jornada del día activo = override del día si existe, si no la global
  useEffect(() => {
    setJornadaState(jornadaPorDia[activeDate] ?? jornadaGlobal);
  }, [activeDate, jornadaPorDia, jornadaGlobal]);

  const latest = snapshots.length ? snapshots[snapshots.length - 1] : null;

  // RE-FIJAR sustituye (nueva foto, delta a cero desde ese momento): guardamos una fila NUEVA con su hora; `latest`
  // pasa a ser esta. No se acumula (el delta se calcula siempre contra la última).
  const fijar = useCallback(async (taskCount: number, estimatedMinutes: number, completedCount: number, planTaskIds: string[] = []) => {
    const snap: DaySnapshot = {
      id: `snap-${Date.now()}`,
      date: activeDate,
      taken_at: new Date().toISOString(),
      task_count: taskCount,
      estimated_minutes: estimatedMinutes,
      completed_count: completedCount,
      plan_task_ids: planTaskIds, // §16.47: el PLAN (ids de las hojas del día ahora). La nota mide el registrado sobre estos.
    };
    setSnapshots(prev => [...prev, snap]); // optimista
    const { error } = await supabase.from('day_snapshots').insert(snap);
    if (error) { setSnapshots(prev => prev.filter(s => s.id !== snap.id)); throw error; }
    return snap;
  }, [activeDate]);

  // §16.119: fijar la jornada del DÍA ACTIVO (override por-día). La global se queda como default para los demás días.
  const setJornada = useCallback(async (minutes: number) => {
    const m = Math.max(0, Math.round(minutes));
    setJornadaState(m);
    setJornadaPorDia(prev => {
      const next = { ...prev, [activeDate]: m };
      supabase.from('settings').upsert({ key: 'jornada_por_dia', value: next, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      return next;
    });
  }, [activeDate]);

  return { snapshots, latest, jornada, fijar, setJornada };
}
