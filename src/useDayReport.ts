// useDayReport.ts — TRAMO 4 (REPORTE). Lee/escribe `day_reports` (una fila por día, upsert por `date`). Guarda la
// valoración automática (snapshot), los motivos marcados y la nota libre. Todo OPCIONAL: el reporte vale por sí solo aunque
// no se guarde nada. El día se congela solo a medianoche; esto NO es un "cerrar el día" obligatorio (§16.39 tramo 4).
import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';

export type MotivoKey = 'desviacion' | 'prioridad' | 'dependencia';

export interface DayReport {
  id: string;
  date: string;
  verdict: string | null;
  measures: any;
  motivos: MotivoKey[];
  nota: string | null;
}

export function useDayReport(activeDate: string) {
  const [report, setReport] = useState<DayReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    (async () => {
      const { data } = await supabase.from('day_reports').select('*').eq('date', activeDate).maybeSingle();
      if (!cancel) { setReport((data as DayReport) || null); setLoading(false); }
    })();
    return () => { cancel = true; };
  }, [activeDate]);

  // Guarda (upsert por fecha) la valoración + motivos + nota. Optimista; revierte si la BD falla.
  const guardar = useCallback(async (
    verdict: string,
    measures: any,
    motivos: MotivoKey[],
    nota: string
  ) => {
    const row: DayReport = {
      id: `report-${activeDate}`,
      date: activeDate,
      verdict,
      measures,
      motivos,
      nota: nota.trim() || null,
    };
    const prev = report;
    setReport(row); // optimista
    const { error } = await supabase
      .from('day_reports')
      .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'date' });
    if (error) { setReport(prev); throw error; }
    return row;
  }, [activeDate, report]);

  return { report, loading, guardar };
}
