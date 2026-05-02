import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

interface Block {
  id: string;
  name: string;
  color: string;
  icon: string;
  order: number;
}

interface Task {
  id: string;
  blockId: string;
  title: string;
  notes?: string;
  priority: string;
  status?: string;
  dueDate?: string;
  dueTime?: string;
  completedAt?: string;
  estimatedMinutes?: number;
  actualMinutes?: number;
  totalEstimatedCombo?: number;
  totalRegisteredCombo?: number;
  tags?: string[];
  order?: number;
  isTemplate?: boolean;
  isActive?: boolean;
  isException?: boolean;
  isDeleted?: boolean;
  isExpanded?: boolean;
  taskType?: string;
  parentTaskId?: string;
  templateId?: string;
  instanceDate?: string;
  recurrence?: any;
  delegation?: any;
  createdAt?: string;
  modifiedAt?: string;
  deletedAt?: string;
}

interface AppData {
  blocks: Block[];
  tasks: Task[];
  // ... resto de datos
}

export const useSupabaseData = () => {
  const [data, setData] = useState<AppData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Cargar datos iniciales
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      console.log('[SUPABASE] Loading data...');
      
      // Cargar bloques
      const { data: blocks, error: blocksError } = await supabase
        .from('work_blocks')
        .select('*')
        .order('order', { ascending: true });

      if (blocksError) throw blocksError;

      // Cargar tareas (excluyendo eliminadas)
      const { data: tasks, error: tasksError } = await supabase
        .from('tasks')
        .select('*')
        .or('is_deleted.is.null,is_deleted.eq.false')
        .order('order', { ascending: true });

      if (tasksError) throw tasksError;

      console.log('[SUPABASE] Loaded:', { blocks: blocks?.length, tasks: tasks?.length });

      // Mapear datos de Supabase a formato de la app
      const mappedBlocks = blocks?.map((b: any) => ({
        id: b.id,
        name: b.name,
        color: b.color,
        icon: b.icon,
        order: b.order || 0
      })) || [];

      const mappedTasks = tasks?.map((t: any) => ({
        id: t.id,
        blockId: t.block_id,
        title: t.title,
        notes: t.notes,
        priority: t.priority,
        status: t.status,
        dueDate: t.due_date,
        dueTime: t.due_time,
        completedAt: t.completed_at,
        estimatedMinutes: t.estimated_minutes,
        actualMinutes: t.actual_minutes,
        totalEstimatedCombo: t.total_estimated_combo,
        totalRegisteredCombo: t.total_registered_combo,
        tags: t.tags || [],
        order: t.order,
        isTemplate: t.is_template,
        isActive: t.is_active,
        isException: t.is_exception,
        isDeleted: t.is_deleted,
        isExpanded: t.is_expanded,
        taskType: t.task_type,
        parentTaskId: t.parent_task_id,
        templateId: t.template_id,
        instanceDate: t.instance_date,
        recurrence: t.recurrence,
        delegation: t.delegation,
        createdAt: t.created_at,
        modifiedAt: t.modified_at,
        deletedAt: t.deleted_at
      })) || [];

      setData({
        blocks: mappedBlocks,
        tasks: mappedTasks
      } as AppData);
      
      setLoading(false);
    } catch (err: any) {
      console.error('[SUPABASE] Error loading data:', err);
      setError(err.message);
      setLoading(false);
    }
  };

  // Guardar tarea
  const saveTask = async (task: Task) => {
    try {
      const dbTask = {
        id: task.id,
        block_id: task.blockId,
        title: task.title,
        notes: task.notes,
        priority: task.priority,
        status: task.status,
        due_date: task.dueDate,
        due_time: task.dueTime,
        completed_at: task.completedAt,
        estimated_minutes: task.estimatedMinutes,
        actual_minutes: task.actualMinutes,
        total_estimated_combo: task.totalEstimatedCombo,
        total_registered_combo: task.totalRegisteredCombo,
        tags: task.tags,
        order: task.order,
        is_template: task.isTemplate,
        is_active: task.isActive,
        is_exception: task.isException,
        is_deleted: task.isDeleted,
        is_expanded: task.isExpanded,
        task_type: task.taskType,
        parent_task_id: task.parentTaskId,
        template_id: task.templateId,
        instance_date: task.instanceDate,
        recurrence: task.recurrence,
        delegation: task.delegation,
        modified_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('tasks')
        .upsert(dbTask);

      if (error) throw error;
      console.log('[SUPABASE] Task saved:', task.id);
    } catch (err: any) {
      console.error('[SUPABASE] Error saving task:', err);
      throw err;
    }
  };

  // Eliminar tarea (soft delete)
  const deleteTask = async (taskId: string) => {
    try {
      const { error } = await supabase
        .from('tasks')
        .update({ 
          is_deleted: true, 
          deleted_at: new Date().toISOString() 
        })
        .eq('id', taskId);

      if (error) throw error;
      console.log('[SUPABASE] Task deleted:', taskId);
    } catch (err: any) {
      console.error('[SUPABASE] Error deleting task:', err);
      throw err;
    }
  };

  return {
    data,
    loading,
    error,
    saveTask,
    deleteTask,
    reload: loadData
  };
};
