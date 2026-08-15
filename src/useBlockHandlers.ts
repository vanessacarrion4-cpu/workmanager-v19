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
    const n = tasksInBlock(id, tasks).length;
    // Antes NO persistía: borraba de estado y al recargar volvía todo (función a medias). Ahora se borra en
    // Supabase; el FK `ON DELETE CASCADE` de `block_id` borra sus tareas en la BD (verificado) → nada queda
    // huérfano. Es PERMANENTE (work_blocks no tiene is_deleted; no hay soft-delete de bloque).
    if (!confirm(`¿Eliminar el bloque «${block?.name || 'sin nombre'}» y sus ${n} tarea${n !== 1 ? 's' : ''}/reglas? Es PERMANENTE, no se puede deshacer.`)) return;

    setBlocks(prev => prev.filter(b => b.id !== id));
    setTasks(prev => {
      const newTasks = { ...prev };
      Object.keys(newTasks).forEach(taskId => {
        if (newTasks[taskId].blockId === id) delete newTasks[taskId];
      });
      return newTasks;
    });

    supabase.from('work_blocks').delete().eq('id', id).then(({ error }) => {
      if (error) {
        console.error('[SUPABASE] Error borrando bloque:', error);
        reportPersistError({ verbo: 'borrar', titulo: block?.name || undefined, singular: 'el bloque', plural: 'bloques' });
      }
    });
  }, [blocks, tasks, setBlocks, setTasks]);

  return {
    handleAddBlock,
    handleUpdateBlock,
    handleReorderBlocks,
    handleToggleBlockActive,
    handleDeleteBlock,
  };
}
