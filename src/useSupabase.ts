/**
 * useSupabase.ts
 * 
 * Hook que gestiona la carga inicial de datos desde Supabase.
 * Responsabilidades:
 * - Cargar bloques, tareas y personas al iniciar
 * - Reconstruir la jerarquía padre-hijo en memoria
 * - Reparaciones automáticas de datos inconsistentes
 * - Marcar existsInSupabase para proteger instancias al regenerar
 */

import { useEffect } from 'react';
import { Task, WorkBlock, Person } from './types';
import { supabase } from './supabaseClient';
import { INITIAL_BLOCKS } from './constants';

interface UseSupabaseOptions {
  setBlocks: (blocks: WorkBlock[]) => void;
  setTasks: (tasks: Record<string, Task>) => void;
  setPeople: (people: Person[]) => void;
  setMeetings: (meetings: any[]) => void;
  setTimeEntries: (entries: any[]) => void;
  setIsDataLoaded: (loaded: boolean) => void;
}

/**
 * Reconstruye el array subtasks[] de cada tarea a partir de parentTaskId.
 * Primera pasada: relaciones directas (parentTaskId → padre)
 */
function reconstructHierarchy(mappedTasks: Record<string, Task>): void {
  Object.values(mappedTasks).forEach(task => {
    if (task.parentTaskId && mappedTasks[task.parentTaskId]) {
      if (!mappedTasks[task.parentTaskId].subtasks) {
        mappedTasks[task.parentTaskId].subtasks = [];
      }
      // NO añadir subtareas borradas al array del padre
      if (!task.isDeleted && !mappedTasks[task.parentTaskId].subtasks.includes(task.id)) {
        mappedTasks[task.parentTaskId].subtasks.push(task.id);
      }
    }
  });
}

/**
 * Segunda pasada: instancias que tienen parentTaskId=null en BD
 * porque se guardan sin FK, pero se pueden reconstruir usando templateId.
 */
function reconstructInstanceHierarchy(mappedTasks: Record<string, Task>): void {
  Object.values(mappedTasks).forEach(task => {
    if (!task.templateId) return; // Solo instancias
    if (task.parentTaskId) return; // Ya tiene padre
    if (task.isDeleted) return;

    const template = mappedTasks[task.templateId];
    if (!template || !template.parentTaskId) return;

    // Buscar la instancia del contenedor padre para este mismo día
    const parentTemplateId = template.parentTaskId;
    const instanceDate = task.instanceDate || task.dueDate;
    if (!instanceDate) return;

    const parentInstanceId = `inst-${parentTemplateId}-${instanceDate}`;
    const parentInstance = mappedTasks[parentInstanceId];

    if (parentInstance) {
      task.parentTaskId = parentInstanceId;
      if (!parentInstance.subtasks) parentInstance.subtasks = [];
      if (!parentInstance.subtasks.includes(task.id)) {
        parentInstance.subtasks.push(task.id);
      }
    }
  });
}

/**
 * Tercera pasada: instancias excepción de contenedores (is_exception:true)
 * que tienen subtasks:[] porque sus subtareas se generan en memoria.
 * Las vincula con las instancias generadas por useGeneration.
 * CRÍTICO: solo modificar instancias (templateId presente), NUNCA templates.
 */
function reconstructExceptionContainerSubtasks(mappedTasks: Record<string, Task>): void {
  Object.values(mappedTasks).forEach(task => {
    if (!task.templateId) return;        // Solo instancias
    if (!task.isException) return;       // Solo excepciones
    if (task.isDeleted) return;
    if (task.parentTaskId) return;       // Solo contenedores raíz
    if (task.subtasks && task.subtasks.length > 0) return; // Ya tiene subtareas

    // Buscar el template padre para obtener sus subtareas template
    const parentTemplate = mappedTasks[task.templateId];
    if (!parentTemplate || !parentTemplate.subtasks || parentTemplate.subtasks.length === 0) return;

    const instanceDate = task.instanceDate || task.dueDate;
    if (!instanceDate) return;

    // Para cada subtarea template del padre, buscar/crear la instancia correspondiente
    const subInstanceIds: string[] = [];
    parentTemplate.subtasks.forEach(subTemplateId => {
      const subTemplate = mappedTasks[subTemplateId];
      if (!subTemplate || subTemplate.isDeleted) return;

      // La instancia generada tendrá id: inst-{subTemplateId}-{instanceDate}
      const subInstanceId = `inst-${subTemplateId}-${instanceDate}`;
      
      // Si ya existe en mappedTasks, vincularla
      if (mappedTasks[subInstanceId]) {
        if (!mappedTasks[subInstanceId].parentTaskId) {
          mappedTasks[subInstanceId] = { ...mappedTasks[subInstanceId], parentTaskId: task.id };
        }
        subInstanceIds.push(subInstanceId);
      }
      // Si no existe aún (se generará en useGeneration), el merge posterior la añadirá
    });

    if (subInstanceIds.length > 0) {
      mappedTasks[task.id] = { ...task, subtasks: subInstanceIds };
    }
  });
}

/**
 * Reparación 1: Contenedores que tienen datos que solo deberían tener las subtareas
 * (dueDate, dueTime, tags, delegation). Los limpia y persiste en Supabase.
 */
function repairContainersWithForbiddenData(mappedTasks: Record<string, Task>): void {
  Object.values(mappedTasks).forEach(task => {
    if (!task.subtasks || task.subtasks.length === 0) return;

    const hasForbiddenData = task.dueDate || task.dueTime ||
      (task.tags && task.tags.length > 0) ||
      task.delegation ||
      (task.recurrence && !task.isTemplate);

    if (hasForbiddenData) {
      console.log('[REPAIR] Limpiando contenedor con datos prohibidos:', task.title);
      mappedTasks[task.id] = {
        ...task,
        dueDate: null,
        dueTime: null,
        tags: [],
        delegation: undefined,
        estimatedMinutes: 0,
      };
      supabase.from('tasks')
        .update({ due_date: null, due_time: null, tags: [], delegation: null, estimated_minutes: 0 })
        .eq('id', task.id)
        .then(({ error }) => {
          if (error) console.error('[REPAIR] Error limpiando contenedor:', error);
          else console.log('[REPAIR] Contenedor limpiado en Supabase:', task.title);
        });
    }
  });
}

/**
 * Reparación 2: Si un contenedor tiene subtareas con recurrence,
 * debe ser isTemplate:true para que generateInstances lo procese.
 */
function repairRecurringContainers(mappedTasks: Record<string, Task>): void {
  Object.values(mappedTasks).forEach(task => {
    if (!task.subtasks || task.subtasks.length === 0) return;

    const hasRecurringChild = task.subtasks.some(subId => {
      const sub = mappedTasks[subId];
      return sub && sub.recurrence;
    });

    if (!hasRecurringChild) return;

    // Reparar el padre
    if (!task.isTemplate) {
      console.log('[REPAIR] Reparando contenedor recurrente:', task.title, '→ isTemplate: true');
      mappedTasks[task.id] = { ...mappedTasks[task.id], isTemplate: true, dueDate: null };
      supabase.from('tasks')
        .update({ is_template: true, due_date: null })
        .eq('id', task.id)
        .then(({ error }) => {
          if (error) console.error('[REPAIR] Error reparando contenedor recurrente:', error);
          else console.log('[REPAIR] Contenedor recurrente reparado en Supabase:', task.title);
        });
    }

    // Reparar subtareas recurrentes sin isTemplate
    task.subtasks.forEach(subId => {
      const sub = mappedTasks[subId];
      if (!sub || !sub.recurrence || sub.isTemplate) return;
      console.log('[REPAIR] Reparando subtarea recurrente:', sub.title, '→ isTemplate: true');
      mappedTasks[subId] = { ...sub, isTemplate: true, dueDate: null };
      supabase.from('tasks')
        .update({ is_template: true, due_date: null })
        .eq('id', subId)
        .then(({ error }) => {
          if (error) console.error('[REPAIR] Error reparando subtarea:', error);
          else console.log('[REPAIR] Subtarea reparada en Supabase:', sub.title);
        });
    });
  });
}

/**
 * Hook principal: carga datos desde Supabase al montar el componente.
 */
export function useSupabase({
  setBlocks,
  setTasks,
  setPeople,
  setMeetings,
  setTimeEntries,
  setIsDataLoaded,
}: UseSupabaseOptions): void {
  useEffect(() => {
    const loadFromSupabase = async () => {
      try {
        console.log('[SUPABASE] Loading initial data...');

        // Cargar bloques
        const { data: blocksData, error: blocksError } = await supabase
          .from('work_blocks')
          .select('*')
          .order('order', { ascending: true });

        if (blocksError) throw blocksError;

        // Cargar tareas: templates/manuales + excepciones (instancias modificadas)
        // Las instancias normales se generan en memoria por useGeneration
        const { data: tasksData, error: tasksError } = await supabase
          .from('tasks')
          .select('*')
          .or('template_id.is.null,is_exception.eq.true')
          .limit(10000);

        if (tasksError) throw tasksError;

        // Cargar personas
        const { data: personsData, error: personsError } = await supabase
          .from('persons')
          .select('*')
          .order('created_at', { ascending: true });

        if (personsError) {
          console.warn('[SUPABASE] Error loading persons:', personsError);
        }

        // Cargar time entries
        const { data: timeEntriesData, error: timeEntriesError } = await supabase
          .from('time_entries')
          .select('*');

        if (timeEntriesError) {
          console.warn('[SUPABASE] Error loading time entries:', timeEntriesError);
        }

        // Cargar reuniones
        const { data: meetingsData, error: meetingsError } = await supabase
          .from('meetings')
          .select('*');

        if (meetingsError) {
          console.warn('[SUPABASE] Error loading meetings:', meetingsError);
        }

        console.log('[SUPABASE] Loaded:', {
          blocks: blocksData?.length,
          tasks: tasksData?.length,
          persons: personsData?.length,
          meetings: meetingsData?.length
        });

        // Mapear bloques
        if (blocksData && blocksData.length > 0) {
          const mappedBlocks = blocksData.map((b: any) => ({
            id: b.id,
            name: b.name,
            color: b.color,
            icon: b.icon,
            order: b.order || 0,
            isActive: b.is_active !== false
          }));
          setBlocks(mappedBlocks);
        } else {
          setBlocks(INITIAL_BLOCKS);
        }

        // Mapear personas
        if (personsData && personsData.length > 0) {
          const mappedPersons = personsData.map((p: any) => ({
            id: p.id,
            name: p.name,
            createdAt: p.created_at
          }));
          setPeople(mappedPersons);
          console.log('[SUPABASE] Loaded persons:', mappedPersons.map((p: any) => p.name).join(', '));
        }

        // Mapear tareas
        if (tasksData && tasksData.length > 0) {
          const mappedTasks: Record<string, Task> = {};
          tasksData.forEach((t: any) => {
            mappedTasks[t.id] = {
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
              isActive: t.is_active !== false,
              isException: t.is_exception,
              isDeleted: t.is_deleted,
              isExpanded: t.is_expanded,
              taskType: t.task_type,
              parentTaskId: t.parent_task_id,
              templateId: t.template_id,
              instanceDate: t.instance_date,
              recurrence: t.recurrence,
              delegation: t.delegation,
              wasRecurring: t.was_recurring || false,
              createdAt: t.created_at,
              modifiedAt: t.modified_at,
              deletedAt: t.deleted_at,
              existsInSupabase: true,
              subtasks: [],
              attachments: []
            };
          });

          // Reconstruir jerarquía (tres pasadas)
          reconstructHierarchy(mappedTasks);
          reconstructInstanceHierarchy(mappedTasks);
          reconstructExceptionContainerSubtasks(mappedTasks);

          // Reparaciones automáticas
          repairContainersWithForbiddenData(mappedTasks);
          repairRecurringContainers(mappedTasks);

          setTasks(mappedTasks);
        }

        // Mapear time entries
        if (timeEntriesData && timeEntriesData.length > 0) {
          const mappedEntries = timeEntriesData.map((e: any) => ({
            id: e.id,
            taskId: e.task_id,
            subtaskId: e.subtask_id,
            date: e.date,
            duration: e.duration,
            note: e.note || '',
            source: e.source || 'manual',
            createdAt: e.created_at
          }));
          setTimeEntries(mappedEntries);
          console.log('[SUPABASE] Loaded time entries:', mappedEntries.length);
        }

        // Mapear reuniones
        if (meetingsData && meetingsData.length > 0) {
          const mappedMeetings = meetingsData.map((m: any) => ({
            id: m.id,
            personId: m.person_id,
            date: m.date,
            notes: m.notes || '',
            items: m.items || [],
            createdAt: m.created_at
          }));
          setMeetings(mappedMeetings);
          console.log('[SUPABASE] Loaded meetings:', mappedMeetings.length);
        }

        setIsDataLoaded(true);
        console.log('[SUPABASE] Data loaded successfully');

        // Limpieza automática: borrar instancias eliminadas de más de 30 días
        // Esto evita que la tabla crezca indefinidamente con basura
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const cutoffDate = thirtyDaysAgo.toISOString().split('T')[0];
        
        supabase.from('tasks')
          .delete()
          .eq('is_deleted', true)
          .not('template_id', 'is', null)
          .lt('instance_date', cutoffDate)
          .then(({ error, count }) => {
            if (!error && count) {
              console.log(`[SUPABASE] Limpieza automática: ${count} instancias borradas antiguas eliminadas`);
            }
          });
      } catch (e) {
        console.error('[SUPABASE] Error loading data:', e);
        setBlocks(INITIAL_BLOCKS);
        setIsDataLoaded(true);
      }
    };

    loadFromSupabase();
  }, []);
}
