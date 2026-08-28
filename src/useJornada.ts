// useJornada.ts — lee la jornada configurable (settings.jornada_minutes, default 480). Solo-lectura, para vistas que
// necesitan el % de carga contra la jornada real de la propietaria (Semana, etc.). La cabecera la escribe vía useDaySnapshot.
import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

const DEFAULT_JORNADA = 480;

export function useJornada(): number {
  const [jornada, setJornada] = useState<number>(DEFAULT_JORNADA);
  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data } = await supabase.from('settings').select('value').eq('key', 'jornada_minutes').maybeSingle();
      const v = (data as any)?.value;
      if (!cancel && v != null) setJornada(Number(v) || DEFAULT_JORNADA);
    })();
    return () => { cancel = true; };
  }, []);
  return jornada;
}
