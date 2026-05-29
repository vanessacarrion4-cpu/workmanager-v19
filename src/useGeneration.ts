/**
 * useGeneration.ts
 * 
 * Hook que gestiona la generación de instancias de tareas recurrentes.
 * Usa un Web Worker para no bloquear el hilo principal.
 * 
 * REGLA CRÍTICA: Solo modifica instancias (templateId presente), NUNCA templates.
 * Modificar templates → cambia templateKey → dispara el effect → bucle infinito.
 */

import { useEffect, useRef, useMemo } from 'react';
import { Task } from './types';
import { formatLocalISO } from './dateUtils';

interface UseGenerationOptions {
  tasks: Record<string, Task>;
  isDataLoaded: boolean;
  setTasks: (updater: (prev: Record<string, Task>) => Record<string, Task>) => void;
}

const MAX_GENERATION_CYCLES = 20;
const DAYS_PAST = 30;      // 1 mes atrás
const DAYS_FUTURE = 60;    // 2 meses adelante (suficiente para Dashboard y Calendario)

/**
 * Calcula una clave que solo cambia cuando se crean/modifican/borran templates reales.
 * NO incluye modifiedAt para evitar que las instancias generadas relancen el effect.
 */
export function useTemplateKey(tasks: Record<string, Task>): string {
  return useMemo(() => {
    return Object.values(tasks)
      .filter(t => t && t.isTemplate && !t.templateId && !t.isDeleted)
      .map(t => `${t.id}:${t.recurrence ? JSON.stringify(t.recurrence) : 'norecurrence'}:${t.isActive}`)
      .sort()
      .join('|');
  }, [tasks]);
}

/**
 * Hook principal: genera instancias cuando cambian los templates.
 * Usa Web Worker para no bloquear la UI.
 */
export function useGeneration({ tasks, isDataLoaded, setTasks }: UseGenerationOptions): void {
  const generationCountRef = useRef<number>(0);
  const prevTemplateKeyRef = useRef<string>('');
  const workerRef = useRef<Worker | null>(null);
  const templateKey = useTemplateKey(tasks);

  useEffect(() => {
    if (!isDataLoaded) return;
    if (templateKey === prevTemplateKeyRef.current && prevTemplateKeyRef.current !== '') return;

    // Protección contra bucle infinito
    generationCountRef.current += 1;
    if (generationCountRef.current > MAX_GENERATION_CYCLES) {
      console.error('[GENERATION] ⛔ Bucle infinito detectado - abortando');
      return;
    }

    prevTemplateKeyRef.current = templateKey;
    console.log('[GENERATION] useEffect triggered #', generationCountRef.current);

    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - DAYS_PAST);
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + DAYS_FUTURE);
    const startStr = formatLocalISO(startDate);
    const endStr = formatLocalISO(endDate);

    // Calcular cleaned fuera del Worker (es sincrónico y rápido)
    setTasks(prev => {
      const cleaned = { ...prev };
      let deletedCount = 0;

      // Limpiar instancias generadas en memoria fuera de la ventana
      // También limpiar instancias borradas (isDeleted:true) para que generateInstances
      // pueda regenerarlas correctamente sin considerar excepciones obsoletas.
      Object.values(cleaned).forEach((t: Task) => {
        if (!t.templateId) return;
        // Siempre eliminar de memoria si está borrada en Supabase
        if (t.isDeleted) {
          delete cleaned[t.id];
          deletedCount++;
          return;
        }
        // Eliminar instancias generadas (no excepciones) fuera de la ventana
        if (
          !t.isException &&
          !(t as any).existsInSupabase &&
          t.dueDate && (t.dueDate < startStr || t.dueDate > endStr)
        ) {
          delete cleaned[t.id];
          deletedCount++;
        }
      });
      console.log(`[GENERATION] Cleaned ${deletedCount} instances`);

      const preserved = Object.values(cleaned).filter(
        (t: Task) => t.templateId && (t.isException || (t as any).existsInSupabase)
      );
      console.log(`[GENERATION] Preserved ${preserved.length} exceptions/supabase instances`);

      return cleaned;
    });

    // Terminar Worker anterior si existe
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }

    // Crear nuevo Worker
    const worker = new Worker(
      new URL('./generation.worker.ts', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;

    // Serializar solo los datos que el Worker necesita
    // (templates + excepciones + instancias existentes)
    // Esto reduce el tamaño del mensaje al Worker
    const tasksForWorker: Record<string, Task> = {};
    Object.values(tasks).forEach((t: Task) => {
      if (t.isDeleted) return;
      tasksForWorker[t.id] = t;
    });

    worker.onmessage = (e: MessageEvent) => {
      const { instances, error } = e.data;

      if (error) {
        console.error('[GENERATION] Worker error:', error);
        return;
      }

      console.log(`[GENERATION] Worker generated ${instances.length} instances`);

      if (instances.length === 0) return;

      setTasks(prev => {
        // Early return: si todas las instancias ya existen y no hay merges pendientes
        const newInstances = instances.filter((t: Task) => !prev[t.id]);
        const needsMerge = instances.some((t: Task) => {
          if (t.parentTaskId || !t.templateId || !t.subtasks?.length) return false;
          const existing = prev[t.id];
          if (!existing || !(existing as any).existsInSupabase || existing.isTemplate) return false;
          return t.subtasks.some((id: string) => !(existing.subtasks || []).includes(id));
        });

        if (newInstances.length === 0 && !needsMerge) {
          console.log('[GENERATION] No new instances or merges needed, skipping');
          return prev;
        }

        const updated = { ...prev };
        let addedCount = 0;

        // PASO 1: Añadir instancias nuevas que no existen aún
        instances.forEach((t: Task) => {
          if (!updated[t.id]) {
            updated[t.id] = t;
            addedCount++;
          }
        });

        // PASO 2: Para contenedores que ya existían en Supabase,
        // hacer merge de sus subtasks con las instancias generadas.
        // CRÍTICO: Solo modificar INSTANCIAS (templateId presente), NUNCA templates.
        instances.forEach((t: Task) => {
          if (t.parentTaskId) return;
          if (!t.templateId) return;
          if (!t.subtasks || t.subtasks.length === 0) return;

          const existingContainer = updated[t.id];
          if (existingContainer && (existingContainer as any).existsInSupabase && !existingContainer.isTemplate) {
            const existingSubIds = new Set(existingContainer.subtasks || []);
            const newSubIds = t.subtasks.filter((id: string) => !existingSubIds.has(id));
            if (newSubIds.length > 0) {
              updated[t.id] = {
                ...existingContainer,
                subtasks: [...(existingContainer.subtasks || []), ...newSubIds]
              };
            }
          }
        });

        // PASO 3: Para subtareas generadas, asegurarse que su contenedor padre las referencia.
        instances.forEach((t: Task) => {
          if (!t.parentTaskId) return;
          if (!t.templateId) return;

          const parent = updated[t.parentTaskId];
          if (parent && parent.templateId && !parent.subtasks?.includes(t.id)) {
            updated[t.parentTaskId] = {
              ...parent,
              subtasks: [...(parent.subtasks || []), t.id]
            };
          }
        });

        console.log(`[GENERATION] Added ${addedCount} new instances`);
        return updated;
      });

      // Limpiar referencia al Worker
      workerRef.current = null;
    };

    worker.onerror = (e) => {
      console.error('[GENERATION] Worker error:', e);
      workerRef.current = null;
    };

    // Enviar datos al Worker
    worker.postMessage({
      tasks: tasksForWorker,
      startDateStr: startStr,
      daysToProject: DAYS_PAST + DAYS_FUTURE
    });

  }, [isDataLoaded, templateKey]);

  // Cleanup: terminar Worker si el componente se desmonta
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);
}
