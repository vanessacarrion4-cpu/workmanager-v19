/**
 * useGeneration.ts
 * 
 * Hook que gestiona la generación de instancias de tareas recurrentes.
 * Responsabilidades:
 * - Detectar cuándo cambian los templates (templateKey)
 * - Limpiar instancias antiguas en memoria
 * - Generar instancias nuevas para los próximos 365 días
 * - Hacer merge con instancias existentes de Supabase
 * - Proteger contra bucles infinitos
 * 
 * REGLA CRÍTICA: Solo modifica instancias (templateId presente), NUNCA templates.
 * Modificar templates → cambia templateKey → dispara el effect → bucle infinito.
 */

import { useEffect, useRef, useMemo } from 'react';
import { Task } from './types';
import { generateInstances } from './utils';
import { formatLocalISO } from './dateUtils';

interface UseGenerationOptions {
  tasks: Record<string, Task>;
  isDataLoaded: boolean;
  setTasks: (updater: (prev: Record<string, Task>) => Record<string, Task>) => void;
}

const MAX_GENERATION_CYCLES = 20;
const DAYS_TO_PROJECT = 365;

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
 */
export function useGeneration({ tasks, isDataLoaded, setTasks }: UseGenerationOptions): void {
  const generationCountRef = useRef<number>(0);
  const prevTemplateKeyRef = useRef<string>('');
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

    const today = formatLocalISO(new Date());

    setTasks(prev => {
      const cleaned = { ...prev };
      let deletedCount = 0;

      // Limpiar instancias generadas en memoria que no son excepciones ni están en Supabase
      // Solo limpiar instancias futuras (desde hoy) para no tocar el historial
      Object.values(cleaned).forEach((t: Task) => {
        if (
          t.templateId &&
          !t.isException &&
          !t.isDeleted &&
          !t.existsInSupabase &&
          t.dueDate && t.dueDate >= today
        ) {
          delete cleaned[t.id];
          deletedCount++;
        }
      });
      console.log(`[GENERATION] Cleaned ${deletedCount} instances`);

      // Log de instancias preservadas (excepciones y las de Supabase)
      const preserved = Object.values(cleaned).filter(
        (t: Task) => t.templateId && (t.isException || t.existsInSupabase)
      );
      console.log(
        `[GENERATION] Preserved ${preserved.length} exceptions/supabase instances:`,
        preserved.map((t: Task) => `${t.id}:${t.status}${t.isDeleted ? ':DELETED' : ''}`)
      );

      // Generar instancias nuevas
      const instantiated = generateInstances(cleaned, today, DAYS_TO_PROJECT);
      console.log(`[GENERATION] Generated ${instantiated.length} instances`);
      if (instantiated.length === 0) return cleaned;

      const updated = { ...cleaned };
      let addedCount = 0;

      // PASO 1: Añadir instancias nuevas que no existen aún
      instantiated.forEach(t => {
        if (!updated[t.id]) {
          updated[t.id] = t;
          addedCount++;
        }
      });

      // PASO 2: Para contenedores que ya existían en Supabase,
      // hacer merge de sus subtasks con las instancias generadas.
      // Soluciona: contenedor en Supabase con subtasks=[] porque sus subtareas
      // no existían aún cuando se guardó.
      // CRÍTICO: Solo modificar INSTANCIAS (templateId presente), NUNCA templates.
      instantiated.forEach(t => {
        if (t.parentTaskId) return; // Es subtarea, no contenedor
        if (!t.templateId) return;  // No es instancia → NO tocar (sería template → bucle)
        if (!t.subtasks || t.subtasks.length === 0) return;

        const existingContainer = updated[t.id];
        if (existingContainer && existingContainer.existsInSupabase && !existingContainer.isTemplate) {
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
      // Soluciona: contenedor existente en Supabase con subtasks=[] cuando se generan
      // subtareas nuevas que apuntan a él.
      // CRÍTICO: Solo modificar si el padre es una INSTANCIA (tiene templateId).
      instantiated.forEach(t => {
        if (!t.parentTaskId) return; // Solo subtareas
        if (!t.templateId) return;   // Solo instancias

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
  }, [isDataLoaded, templateKey]);
}
