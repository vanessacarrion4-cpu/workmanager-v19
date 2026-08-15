/**
 * useBlockHandlers.ts
 *
 * Handlers de bloques de trabajo: crear, editar, reordenar, activar/desactivar, borrar.
 * Extraído de App.tsx.
 */

import { useCallback } from 'react';
import { WorkBlock, Task } from './types';
import { supabase } from './supabaseClient';
import { COLORS } from './constants';
import { reportPersistError } from './persist'; // Avisos (B1): escrituras que fallan avisan
import { mapDbTaskToTask } from './useSupabase'; // sesión 19: restaurar bloque re-fetchea sus tareas

interface UseBlockHandlersOptions {
  blocks: WorkBlock[];
  setBlocks: React.Dispatch<React.SetStateAction<WorkBlock[]>>;
  tasks: Record<string, Task>;
  setTasks: React.Dispatch<React.SetStateAction<Record<string, Task>>>;
  setEditingBlockId: (id: string | null) => void;
}

/**
 * tasksInBlock — ids de TODAS las tareas de un bloque (helper puro, testeable).
 * Toda tarea (contenedor, hija, instancia recurrente, excepción) lleva `blockId`, así que un filtro plano
 * por `blockId` captura la jerarquía entera → al borrar el bloque no queda ninguna hija huérfana. Es el mismo
 * conjunto que borra la BD por el FK `ON DELETE CASCADE` de `block_id` (verificado en vivo).
 */
export function tasksInBlock(blockId: string, tasks: Record<string, Task>): string[] {
  return Object.values(tasks).filter((t) => t && t.blockId === blockId).map((t) => t.id);
}

/** Tareas VIVAS de un bloque (las que se soft-borran al borrar el bloque; se marcan con `deleted_with_block`). */
export function liveTasksInBlock(blockId: string, tasks: Record<string, Task>): string[] {
  return Object.values(tasks).filter((t) => t && t.blockId === blockId && !t.isDeleted).map((t) => t.id);
}

/** Tareas a RESTAURAR al recuperar un bloque: SOLO las que se borraron CON él (`deletedWithBlock === blockId`).
 *  Así no resucitan las que ya estaban borradas de antes (marcadores, histórico, prunables). */
export function tasksToRestoreWithBlock(blockId: string, tasks: Record<string, Task>): string[] {
  return Object.values(tasks).filter((t) => t && t.deletedWithBlock === blockId).map((t) => t.id);
}

export function useBlockHandlers({
  blocks,
  setBlocks,
  tasks,
  setTasks,
  setEditingBlockId,
}: UseBlockHandlersOptions) {

  const handleAddBlock = useCallback(async () => {
    const id = `b-${Date.now()}`;
    const newBlock: WorkBlock = {
      id,
      name: '',
      color: COLORS.turquesa.main,
      pastelColor: COLORS.turquesa.pastel,
      icon: '🏢',
      isActive: true,
      order: blocks.length
    };

    try {
      const { error } = await supabase.from('work_blocks').insert({
        id: newBlock.id,
        name: newBlock.name,
        color: newBlock.color,
        pastel_color: newBlock.pastelColor,
        icon: newBlock.icon,
        is_active: newBlock.isActive,
        order: newBlock.order
      });
      if (error) throw error;
      setBlocks(prev => [...prev, newBlock]);
      setEditingBlockId(id);
    } catch (e) {
      console.error('[SUPABASE] Error creating block:', e);
      reportPersistError({ verbo: 'crear', titulo: newBlock.name || undefined, singular: 'el bloque', plural: 'bloques' });
    }
  }, [blocks, setBlocks, setEditingBlockId]);

  const handleUpdateBlock = useCallback(async (updated: WorkBlock) => {
    try {
      const { error } = await supabase.from('work_blocks').update({
        name: updated.name,
        color: updated.color,
        pastel_color: updated.pastelColor,
        icon: updated.icon,
        is_active: updated.isActive,
        order: updated.order
      }).eq('id', updated.id);
      if (error) throw error;
      setBlocks(prev => prev.map(b => b.id === updated.id ? updated : b));
      setEditingBlockId(null);
    } catch (e) {
      console.error('[SUPABASE] Error updating block:', e);
      reportPersistError({ verbo: 'guardar', titulo: updated.name || undefined, singular: 'el bloque', plural: 'bloques' });
    }
  }, [setBlocks, setEditingBlockId]);

  const handleReorderBlocks = useCallback(async (newOrder: WorkBlock[]) => {
    const updated = newOrder.map((b, i) => ({ ...b, order: i + 1 }));
    try {
      const promises = updated.map(block =>
        supabase.from('work_blocks').update({ order: block.order }).eq('id', block.id)
      );
      await Promise.all(promises);
      setBlocks(updated);
    } catch (e) {
      console.error('[SUPABASE] Error reordering blocks:', e);
      reportPersistError({ verbo: 'reordenar', singular: 'los bloques', plural: 'bloques' });
    }
  }, [setBlocks]);

  const handleToggleBlockActive = useCallback(async (id: string) => {
    const block = blocks.find(b => b.id === id);
    if (!block) return;
    const newIsActive = !block.isActive;
    try {
      const { error } = await supabase.from('work_blocks').update({ is_active: newIsActive }).eq('id', id);
      if (error) throw error;
      setBlocks(prev => prev.map(b => b.id === id ? { ...b, isActive: newIsActive } : b));
    } catch (e) {
      console.error('[SUPABASE] Error toggling block:', e);
      reportPersistError({ verbo: 'guardar', titulo: block.name || undefined, singular: 'el bloque', plural: 'bloques' });
    }
  }, [blocks, setBlocks]);

  const handleDeleteBlock = useCallback((id: string) => {
    const block = blocks.find(b => b.id === id);
    const n = liveTasksInBlock(id, tasks).length;
    // SOFT-DELETE reversible (sesión 19): NUNCA un DELETE físico (dispararía el FK `block_id ON DELETE CASCADE`
    // y borraría el árbol entero sin vuelta). Se marca `is_deleted` en el bloque y en sus tareas VIVAS, y estas
    // llevan `deleted_with_block=id` para que `handleRestoreBlock` restaure SOLO estas (no las ya borradas de antes).
    if (!confirm(`¿Eliminar el bloque «${block?.name || 'sin nombre'}» y sus ${n} tarea${n !== 1 ? 's' : ''}? Se puede recuperar.`)) return;
    const ts = new Date().toISOString();

    // Estado: fuera de la vista (se marcan borradas en BD). Al recargar no vuelven (la carga filtra is_deleted).
    setBlocks(prev => prev.filter(b => b.id !== id));
    setTasks(prev => {
      const newTasks = { ...prev };
      Object.keys(newTasks).forEach(taskId => {
        if (newTasks[taskId].blockId === id) delete newTasks[taskId];
      });
      return newTasks;
    });

    // BD: soft-delete del bloque + de sus tareas VIVAS (marcadas con este bloque). Solo `is_deleted=false` → no
    // re-tocar ni re-marcar las que ya estaban borradas.
    supabase.from('work_blocks').update({ is_deleted: true }).eq('id', id).then(({ error }) => {
      if (error) {
        console.error('[SUPABASE] Error borrando (soft) bloque:', error);
        reportPersistError({ verbo: 'borrar', titulo: block?.name || undefined, singular: 'el bloque', plural: 'bloques' });
      }
    });
    supabase.from('tasks').update({ is_deleted: true, deleted_at: ts, deleted_with_block: id })
      .eq('block_id', id).eq('is_deleted', false).then(({ error }) => {
        if (error) console.error('[SUPABASE] Error borrando (soft) tareas del bloque:', error);
      });
  }, [blocks, tasks, setBlocks, setTasks]);

  const handleRestoreBlock = useCallback(async (id: string) => {
    // Recuperar un bloque soft-borrado: restaura el bloque y SOLO las tareas que se borraron CON él
    // (`deleted_with_block=id`) → no resucita las que ya estaban borradas de antes.
    const { error: eB } = await supabase.from('work_blocks').update({ is_deleted: false }).eq('id', id);
    if (eB) { console.error('[SUPABASE] Error restaurando bloque:', eB); reportPersistError({ verbo: 'guardar', singular: 'el bloque', plural: 'bloques' }); return; }
    const { error: eT } = await supabase.from('tasks').update({ is_deleted: false, deleted_with_block: null }).eq('deleted_with_block', id);
    if (eT) console.error('[SUPABASE] Error restaurando tareas del bloque:', eT);

    // Estado: re-fetch del bloque + sus tareas (reconstrucción directa de subtasks por parent_task_id dentro del
    // set restaurado). La reconstrucción completa (instancias recurrentes) queda canónica en el próximo recargado.
    const { data: blk } = await supabase.from('work_blocks').select('*').eq('id', id).maybeSingle();
    const { data: tks } = await supabase.from('tasks').select('*')
      .eq('block_id', id).neq('is_deleted', true).or('template_id.is.null,is_exception.eq.true');
    if (blk) {
      setBlocks(prev => prev.some(b => b.id === id) ? prev : [...prev, {
        id: blk.id, name: blk.name, color: blk.color, pastelColor: blk.pastel_color,
        icon: blk.icon, order: blk.order || 0, isActive: blk.is_active !== false, isDeleted: false,
      }].sort((a, b) => (a.order || 0) - (b.order || 0)));
    }
    if (tks && tks.length) {
      const restored: Record<string, Task> = {};
      tks.forEach((t: any) => { restored[t.id] = mapDbTaskToTask(t); });
      tks.forEach((t: any) => { if (t.parent_task_id && restored[t.parent_task_id]) restored[t.parent_task_id].subtasks.push(t.id); });
      setTasks(prev => ({ ...prev, ...restored }));
    }
  }, [setBlocks, setTasks]);

  return {
    handleAddBlock,
    handleUpdateBlock,
    handleReorderBlocks,
    handleToggleBlockActive,
    handleDeleteBlock,
    handleRestoreBlock,
  };
}
