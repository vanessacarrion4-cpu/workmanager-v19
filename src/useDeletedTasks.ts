// useDeletedTasks.ts — PAPELERA (§16.47). Lee las tareas soft-deleted de los ÚLTIMOS 30 DÍAS y SOLO a partir de la fecha de
// lanzamiento (settings.papelera_since) → las 524 históricas (todas ≤ 21/08, verificado) quedan fuera. No hay borrado duro:
// todo es soft-delete, así que la papelera solo MUESTRA y RESTAURA. Pasados 30 días una entrada deja de mostrarse (el dato
// sigue en BD, recuperable por si acaso).
import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';

export interface DeletedTask {
  id: string;
  title: string;
  blockId: string;
  parentTaskId: string | null;
  dueDate: string | null;
  instanceDate: string | null;
  templateId: string | null;
  taskType?: 'core' | 'adhoc';
  deletedAt: string | null;
  deletedWithBlock: string | null;
  isTemplate: boolean;
}

const mapRow = (t: any): DeletedTask => ({
  id: t.id,
  title: t.title || '',
  blockId: t.block_id,
  parentTaskId: t.parent_task_id ?? null,
  dueDate: t.due_date ?? null,
  instanceDate: t.instance_date ?? null,
  templateId: t.template_id ?? null,
  taskType: t.task_type,
  deletedAt: t.deleted_at ?? null,
  deletedWithBlock: t.deleted_with_block ?? null,
  isTemplate: !!t.is_template,
});

export function useDeletedTasks() {
  const [deleted, setDeleted] = useState<DeletedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey(k => k + 1), []);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      // papelera_since: la fecha de lanzamiento (una vez). Sin ella, se fija AHORA (excluye todo lo anterior).
      let since: string;
      const { data: s } = await supabase.from('settings').select('value').eq('key', 'papelera_since').maybeSingle();
      const v = (s as any)?.value;
      if (v) since = String(v);
      else {
        since = new Date().toISOString();
        await supabase.from('settings').upsert({ key: 'papelera_since', value: since, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      }
      const d30 = new Date(Date.now() - 30 * 86400000).toISOString();
      const cutoff = since > d30 ? since : d30; // max(lanzamiento, hoy−30d)
      const { data } = await supabase
        .from('tasks').select('*')
        .eq('is_deleted', true)
        .not('deleted_at', 'is', null)
        .gte('deleted_at', cutoff)
        .order('deleted_at', { ascending: false });
      if (!cancel) { setDeleted((data || []).map(mapRow)); setLoading(false); }
    })();
    return () => { cancel = true; };
  }, [reloadKey]);

  return { deleted, loading, reload };
}
