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

  // Jornada (una sola vez)
  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data } = await supabase.from('settings').select('value').eq('key', 'jornada_minutes').maybeSingle();
      const v = (data as any)?.value;
      if (!cancel && v != null) setJornadaState(Number(v) || DEFAULT_JORNADA);
    })();
    return () => { cancel = true; };
  }, []);

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

  const setJornada = useCallback(async (minutes: number) => {
    const m = Math.max(0, Math.round(minutes));
    setJornadaState(m);
    await supabase.from('settings')
      .upsert({ key: 'jornada_minutes', value: m, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  }, []);

  return { snapshots, latest, jornada, fijar, setJornada };
}
