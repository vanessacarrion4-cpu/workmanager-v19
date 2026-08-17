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
import { diag } from './diag'; // DIAG-TEMP (sesión 15): quitar con el revert del commit de diagnóstico

interface UseSupabaseOptions {
  setBlocks: (blocks: WorkBlock[]) => void;
  setTasks: (tasks: Record<string, Task>) => void;
  setPeople: (people: Person[]) => void;
  setMeetings: (meetings: any[]) => void;
  setTimeEntries: (entries: any[]) => void;
  setIsDataLoaded: (loaded: boolean) => void;
}

/**
 * Mapea una fila cruda de `tasks` (Supabase) al modelo `Task`. Fuente ÚNICA del mapeo — la usan la carga
 * inicial y `handleRestoreBlock` (recuperar un bloque re-fetchea sus tareas). `subtasks` se reconstruye aparte.
 */
export function mapDbTaskToTask(t: any): Task {
  return {
    id: t.id,
    blockId: t.block_id,
    title: t.title,
    notes: t.notes,
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
    onHold: t.on_hold ?? false,
    parentTaskId: t.parent_task_id,
    templateId: t.template_id,
    instanceDate: t.instance_date,
    recurrence: t.recurrence,
    delegation: t.delegation,
    wasRecurring: t.was_recurring || false,
    createdAt: t.created_at,
    modifiedAt: t.modified_at,
    deletedAt: t.deleted_at,
    deletedWithBlock: t.deleted_with_block ?? null,
    existsInSupabase: true,
    subtasks: [],
    attachments: t.attachments || []
  } as Task;
}

/**
 * Reconstruye el array subtasks[] de cada tarea a partir de parentTaskId.
 * Primera pasada: relaciones directas (parentTaskId → padre)
 * Al final ordena cada array subtasks[] por el campo order de cada subtarea.
 */
function reconstructHierarchy(mappedTasks: Record<string, Task>): void {
  Object.values(mappedTasks).forEach(task => {
    if (task.parentTaskId && mappedTasks[task.parentTaskId]) {
      if (!mappedTasks[task.parentTaskId].subtasks) {
        mappedTasks[task.parentTaskId].subtasks = [];
      }
      // NO añadir subtareas borradas al array del padre
      if (!task.isDeleted && !mappedTasks[task.parentTaskId].subtasks!.includes(task.id)) {
        mappedTasks[task.parentTaskId].subtasks!.push(task.id);
      }
    }
  });

  // Ordenar subtasks[] de cada tarea por el campo order de las subtareas
  Object.values(mappedTasks).forEach(task => {
    if (task.subtasks && task.subtasks.length > 1) {
      task.subtasks.sort((a, b) => {
        const orderA = mappedTasks[a]?.order ?? 9999;
        const orderB = mappedTasks[b]?.order ?? 9999;
        return orderA - orderB;
      });
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
 * Bug #21 (sesión 19): reordenar subtareas de un contenedor RECURRENTE no sobrevivía a la recarga.
 * `reconstructInstanceHierarchy` puebla `subtasks` en orden de ITERACIÓN (push), no por `order`.
 * El reorden persiste el `order` de cada hija: para hijas `inst-` lo escribe en su PLANTILLA-hija
 * (`useTaskOrdering`, `dbId = sub.templateId`), para manuales en la propia hija. Por eso la clave de
 * orden correcta es: `order` de la PLANTILLA de la hija si es instancia, o el `order` propio si es manual
 * (esa es la trampa — la instancia suele venir con `order` 0/sin set). Idempotente para el path de
 * excepción (que ya venía ordenado por `parentTemplate.subtasks`). Solo reconstrucción en memoria: 0 escrituras.
 */
export function sortInstanceContainerSubtasks(mappedTasks: Record<string, Task>): void {
  const orderKey = (childId: string): number => {
    const child = mappedTasks[childId];
    if (!child) return 9999;
    if (child.templateId && mappedTasks[child.templateId] && mappedTasks[child.templateId]!.order != null) {
      return mappedTasks[child.templateId]!.order as number;
    }
    return child.order ?? 9999;
  };
  Object.values(mappedTasks).forEach(inst => {
    if (!inst.templateId) return;                       // solo instancias-contenedor
    if (!inst.subtasks || inst.subtasks.length < 2) return;
    const sorted = [...inst.subtasks].sort((a, b) => orderKey(a) - orderKey(b));
    mappedTasks[inst.id] = { ...inst, subtasks: sorted };
  });
}

/**
 * Reparación 1: Contenedores que tienen datos que solo deberían tener las subtareas
 * (dueDate, dueTime, tags, delegation). Los limpia y persiste en Supabase.
 */
function repairContainersWithForbiddenData(mappedTasks: Record<string, Task>): void {
  Object.values(mappedTasks).forEach(task => {
    if (!task.subtasks || task.subtasks.length === 0) return;
    if (!task.isTemplate) return; // Solo limpiar templates, nunca instancias ni tareas manuales

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
      const _diagT0 = Date.now(); // DIAG-TEMP
      diag('carga:INICIO'); // DIAG-TEMP
      try {
        // Cargar bloques (sesión 19: no traer los soft-borrados)
        const { data: blocksData, error: blocksError } = await supabase
          .from('work_blocks')
          .select('*')
          .neq('is_deleted', true)
          .order('order', { ascending: true });

        if (blocksError) throw blocksError;

        // Cargar tareas: templates/manuales + excepciones (instancias modificadas)
        // Las instancias normales se generan en memoria por useGeneration
        // Cargar tareas con paginación para superar el límite de 1000 de PostgREST
        let tasksData: any[] = [];
        let tasksError = null;
        let from = 0;
        const PAGE_SIZE = 1000;
        while (true) {
          const { data, error } = await supabase
            .from('tasks')
            .select('*')
            // No cargar las BORRADAS que NO son marcadores. Un marcador de borrado (que materializeDay lee
            // para suprimir una ocurrencia) SIEMPRE tiene is_exception:true — `indexExceptionsByTemplate` solo
            // indexa filas con `templateId && isException`, así que una borrada sin is_exception NUNCA suprime
            // nada (y `reconstruct*` la ignora por isDeleted). Antes: `template_id.is.null,is_exception.eq.true`
            // traía esas borradas inútiles (~281 hoy, creciendo). Ahora: exception (incl. marcadores borrados)
            // O manual/plantilla VIVA. Verificado: se conservan los 478 marcadores. (item 2, sesión 19)
            .or('is_exception.eq.true,and(template_id.is.null,is_deleted.eq.false)')
            .range(from, from + PAGE_SIZE - 1);
          if (error) { tasksError = error; break; }
          if (!data || data.length === 0) break;
          tasksData = [...tasksData, ...data];
          if (data.length < PAGE_SIZE) break;
          from += PAGE_SIZE;
        }

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

        // Mapear bloques
        if (blocksData && blocksData.length > 0) {
          const mappedBlocks = blocksData.map((b: any) => ({
            id: b.id,
            name: b.name,
            color: b.color,
            pastelColor: b.pastel_color,
            icon: b.icon,
            order: b.order || 0,
            isActive: b.is_active !== false,
            isDeleted: b.is_deleted === true
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
        }

        // Mapear tareas
        if (tasksData && tasksData.length > 0) {
          const mappedTasks: Record<string, Task> = {};
          tasksData.forEach((t: any) => {
            mappedTasks[t.id] = mapDbTaskToTask(t);
          });

          // Reconstruir jerarquía (tres pasadas)
          reconstructHierarchy(mappedTasks);
          reconstructInstanceHierarchy(mappedTasks);
          reconstructExceptionContainerSubtasks(mappedTasks);
          // Bug #21: ordenar las subtareas de los contenedores-instancia por el `order` de la plantilla-hija
          // (tras las dos pasadas que pueblan instancias). Sin esto el reorden de recurrentes no persistía.
          sortInstanceContainerSubtasks(mappedTasks);

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
        }

        setIsDataLoaded(true);
        diag('carga:FIN (isDataLoaded=true)', { tareas: tasksData?.length ?? 0, ms: Date.now() - _diagT0 }); // DIAG-TEMP

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
