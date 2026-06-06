# WorkManager v19 — Documento de Contexto Completo

> Usar este documento al inicio de cada sesión de desarrollo para dar contexto completo al asistente.
> Última actualización: 06/06/2026 (sesión 2)

---

## 1. Stack y Repositorio

- **Framework**: React + TypeScript + Vite + Tailwind CSS + Framer Motion + lucide-react
- **Base de datos**: Supabase (PostgreSQL via PostgREST)
- **Repo**: `vanessacarrion4-cpu/workmanager-v19` (GitHub)
- **Deploy**: Vercel CI/CD automático desde rama `master`
- **URL producción**: `workmanager-v19.vercel.app`
- **Supabase URL**: `yewfmfoljidvrxvbrsdv.supabase.co`
- **Puerto desarrollo local**: `http://localhost:3001` (CMD como administrador, no PowerShell)

---

## 2. Estructura de Archivos (src/)

```
src/
├── App.tsx                    # Componente raíz (~3800 líneas). Estado global, handlers, routing entre vistas
├── types.ts                   # Interfaces TypeScript: Task, WorkBlock, TimeEntry, Person, etc.
├── constants.ts               # INITIAL_BLOCKS, COLORS, TAG_LABELS
├── supabaseClient.ts          # Inicialización cliente Supabase
├── dateUtils.ts               # formatLocalISO(), parseLocalISO()
├── utils.ts                   # generateInstances(), isTaskCompleted(), projectLoad(), etc.
├── filters.ts                 # filterTasksForDay(), groupTasksByTag(), getStatsForDay()
├── useSupabase.ts             # Hook: carga inicial desde Supabase + reparaciones automáticas
├── useGeneration.ts           # Hook: genera instancias recurrentes via Web Worker
├── generation.worker.ts       # Web Worker: ejecuta generateInstances en hilo separado
├── useSupabaseData.ts         # Hook legacy (no usado activamente en producción)
├── DashboardView.tsx          # Vista principal del día
├── BlocksView.tsx             # Vista de gestión de bloques y tareas (templates)
├── CalendarView.tsx           # Vista de calendario mensual con carga por día
├── DelegadasView.tsx          # Vista de tareas delegadas por persona
├── SearchView.tsx             # Búsqueda global de tareas con filtros
├── WorkloadView.tsx           # Vista de carga de trabajo por bloques
├── components.tsx             # Todos los componentes reutilizables (~3200 líneas)
├── main.tsx                   # Entry point React (StrictMode)
└── index.css                  # Tailwind + scrollbar custom dark/light
```

**IMPORTANTE**: El `TaskModal` está en `App.tsx`, NO en `components.tsx`.

---

## 3. Tablas Supabase

| Tabla | Contenido |
|-------|-----------|
| `work_blocks` | Bloques de trabajo (nombre, color, icono, orden) |
| `tasks` | Templates, tareas manuales, instancias excepción |
| `persons` | Personas para delegación |
| `time_entries` | Registros de tiempo (manual y cronómetro) |
| `meetings` | Reuniones de delegación con notas e items |
| `task_subtasks` | Tabla de relaciones (no usada activamente) |
| `attachments` | Metadata adjuntos (los archivos en Storage) |
| `delegation_meetings` / `delegation_meeting_items` | Tablas legacy |

**NOTA**: La tabla `tasks` NO tiene columna `subtasks`. El array `subtasks[]` se reconstruye en memoria desde `parent_task_id` en `reconstructHierarchy`.

### Convención de columnas: snake_case en BD, camelCase en código

| BD | Código |
|----|--------|
| `template_id` | `templateId` |
| `instance_date` | `instanceDate` |
| `is_exception` | `isException` |
| `is_template` | `isTemplate` |
| `parent_task_id` | `parentTaskId` |
| `due_date` | `dueDate` |
| `block_id` | `blockId` |

---

## 4. Modelo de Datos — Tipo Task

```typescript
Task {
  id: string                  // "t-{timestamp}" o "inst-{templateId}-{YYYY-MM-DD}"
  blockId: string             // A qué bloque pertenece
  title: string
  status: 'pending' | 'completed'
  dueDate: string | null      // YYYY-MM-DD. NUNCA en contenedores.
  dueTime?: string            // HH:mm
  tags: TagType[]             // 'con_hora' | 'focus' | 'dirección' | 'espera' | 'resto'
  priority: 'alta' | 'media' | 'baja'
  estimatedMinutes: number
  
  // Jerarquía
  parentTaskId?: string       // ID del padre (si es subtarea)
  subtasks?: string[]         // IDs de hijos directos (reconstruido en memoria)
  
  // Recurrencia
  isTemplate?: boolean        // true = plantilla maestra (no aparece en Dashboard)
  templateId?: string         // ID del template del que viene esta instancia
  instanceDate?: string       // Fecha original a la que pertenece esta instancia
  isException?: boolean       // true = instancia modificada → guardada en Supabase
  recurrence?: {              // SOLO en subtareas template, NUNCA en contenedores
    frequency: 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly'
    weekDays?: number[]       // [0=lunes...6=domingo]
    monthDay?: number         // 1-31
    yearDay?: number          // 1-31 (día del mes para recurrencia anual)
    yearMonth?: number        // 1-12 (mes para recurrencia anual)
    startDate: string         // YYYY-MM-DD (fecha inicio de la serie, no la fecha de ocurrencia)
    endDate?: string | null
  }
  
  // Flags
  isDeleted?: boolean         // Soft delete
  isActive?: boolean          // Si el template genera instancias
  isExpanded?: boolean        // UI: expandido/colapsado
  wasRecurring?: boolean      // Marca informativa al completar
  existsInSupabase?: boolean  // Solo en memoria: protege instancias en useGeneration
  
  // Otros
  delegation?: { personId: string, delegatedAt: string }
  attachments?: Attachment[]
  taskType?: 'core' | 'adhoc'
  order: number
  notes?: string
  completedAt?: string | null
}
```

---

## 5. Arquitectura de Recurrencia — CRÍTICO

### Estructura en Supabase (persistido)
```
Contenedor template (isTemplate:true, dueDate:null, recurrence:null)
  └── Subtarea template (isTemplate:true, recurrence:{frequency:'monthly', monthDay:1}, dueDate:null)
  └── Subtarea template (isTemplate:true, recurrence:{frequency:'monthly', monthDay:16}, dueDate:null)
```

### Instancias generadas en memoria (NO en Supabase)
```
inst-{containerTemplateId}-2026-06-01  (isTemplate:false, dueDate:'2026-06-01')
  └── inst-{subtaskTemplateId}-2026-06-01  (isTemplate:false, dueDate:'2026-06-01')
```

### Excepción (persistida en Supabase con is_exception:true)
```
inst-{subtaskTemplateId}-2026-06-05  (is_exception:true, instance_date:'2026-06-06', due_date:'2026-06-05')
```

### Reglas CRÍTICAS de recurrencia
1. Los **contenedores** son comparsa — NUNCA tienen `recurrence`, `dueDate`, `dueTime`, `tags`, ni `delegation`
2. La **recurrencia va solo en las subtareas** (nivel 2)
3. Las **instancias normales NO se guardan** en Supabase — se regeneran en memoria cada vez
4. Solo se guardan si `isException: true` (modificadas individualmente)
5. `useGeneration` solo modifica instancias (`templateId` presente), **NUNCA** templates
6. Modificar un template → cambia `templateKey` → dispara `useGeneration` → nuevo ciclo de generación
7. **Recurrencia anual**: usa `yearDay` + `yearMonth`. `startDate` es inicio de serie (distinto de ocurrencia). `matchesRecurrence` tiene caso `'yearly'` en `utils.ts` y `generation.worker.ts`.

---

## 6. Flujo de Carga al Iniciar (useSupabase.ts)

1. Carga `work_blocks`, `persons`, `time_entries`, `meetings`
2. Carga `tasks` con filtro: `template_id IS NULL OR is_exception = true`
3. Reconstruye jerarquía en **3 pasadas**:
   - `reconstructHierarchy`: parentTaskId → subtasks[] — **ordena por campo `order`** al final
   - `reconstructInstanceHierarchy`: reconstruye padre de excepciones sin FK
   - `reconstructExceptionContainerSubtasks`: vincula subtareas a contenedores excepción
4. **Reparaciones automáticas**: `repairContainersWithForbiddenData`, `repairRecurringContainers`
5. Limpieza de instancias borradas >30 días
6. `setIsDataLoaded(true)`

---

## 7. Handlers Principales (App.tsx)

### `handleGoToTemplate(templateId)`
- Navega a vista Bloques (`setCurrentView('blocks')`)
- Si la tarea tiene padre, lo expande (`isExpanded:true`, persiste a Supabase)
- Activa `highlightTaskId` → BlocksView hace scroll y resalta la tarea
- Auto-limpia highlight a los 4 segundos

### `handleUpdateSubtasksOrder(parentId, subtaskIds)`
- Persiste `order` de cada subtarea en Supabase
- El orden real al recargar viene del campo `order` (reconstructHierarchy ordena por él)

### `bulkDuplicateTasks()`
- Parámetro `isRoot:true` añade "(copia)" a la tarea seleccionada; `isRoot:false` para sus hijos
- Si subtarea tiene padre, la copia se inserta después del original y actualiza el padre

---

## 8. Componentes Reutilizables (components.tsx)

### TaskCard — Props clave nuevas (sesión 06/06/2026)
```typescript
onGoToTemplate?: (templateId: string) => void  // navega a Bloques y resalta
onViewInstances?: (task: Task) => void          // abre InstancesModal (SOLO Bloques)
highlightTaskId?: string | null                 // resalta y hace scroll (ref + setTimeout 500ms)
showDelegationDates?: boolean                   // muestra EJEC./DELEG. (SOLO Delegadas)
forceExpanded?: boolean | null                  // fuerza expandido/colapsado (Bloques)
```

### Chips de recurrencia
- **Instancias** (`task.templateId && !hasSubtasks`): chip turquesa + botón ↗
- **Templates** (`task.isTemplate && task.recurrence && !task.templateId`): botón ↗ turquesa + botón ⓘ azul (solo si `onViewInstances`)
- **Editable** (`!hasSubtasks && !task.templateId && !task.isTemplate`): RecurrencePickerChip
- `hasSubtasks` filtra IDs `inst-...` — solo cuenta subtareas `t-...`

### InstancesModal
- Abierto desde ⓘ en Bloques
- Futuros (60d) + pasados (180d, toggle)
- Estados: Pendiente / Editada / Movida / Completada / Borrada
- Acciones: Editar (TaskModal), Borrar, **Restaurar** (borra excepción is_deleted de Supabase → instancia se regenera)

---

## 9. Vistas

### BlocksView.tsx
- **`expandedIds` (estado local)**: todos colapsados por defecto. Expand/collapse local, no persiste.
- Al recibir `highlightTaskId`: expande padre automáticamente + scroll via `ref` en TaskCard
- Pasa `onViewInstances` → botón ⓘ en TaskCards

### DelegadasView.tsx
- **Lista principal usa TaskCard** (no render custom) con `variant="FULL"`
- `showDelegationDates={true}` → fechas EJEC./DELEG. a la derecha
- **Filtro**: solo `isTemplate:true` o `!templateId` (no instancias, no excepciones)
- Subtareas del contenedor también filtradas igual
- `onGoToTemplate` en todos los TaskCards → botón ↗ en recurrentes

---

## 10. Bugs Resueltos — Sesión 06/06/2026

21. Recurrencia anual no funcionaba — `matchesRecurrence` sin caso `yearly`, chips leían `startDate`
22. Duplicar subtarea creaba como raíz — no preservaba `parentTaskId`
23. Título "(copia)" no aparecía en subtareas — lógica `isRoot` rota
24. Orden subtareas en Bloques no persistía — `reconstructHierarchy` no ordenaba por `order`
25. InstancesModal implementado con Restaurar
26. Navegación Dashboard/Delegadas → Bloques con ↗ y highlight/scroll
27. BlocksView estado local expandedIds — todo colapsado por defecto
28. DelegadasView usa TaskCard en lista principal
29. RecurrencePickerChip editable solo en tareas manuales
30. `hasSubtasks` ignora instancias generadas

---

## 11. Bugs Pendientes

| Bug | Síntoma | Prioridad |
|-----|---------|-----------|
| Tareas completadas no desaparecen del Dashboard | Al marcar como completada, sigue visible | Alta |
| Vista Bloques — contenedores no colapsan por defecto | Al entrar a un bloque, aparecen expandidos. `expandedIds` implementado pero no funciona | Alta |
| Highlight en SearchView | Debería funcionar igual que `highlightTaskId` (borde turquesa + scroll) en vez del fondo amarillo | Media |
| Nivel 3 sin indentación visual | Sub-subtareas iguales a nivel 2 | Media |
| Logs debug en components.tsx | `[PICKING DEBUG]`, `[CHIP DEBUG]`, `[CHIP RENDER]` pendientes de limpiar | Baja |
| Logs debug en DashboardView | `[STATS DEBUG]` pendientes de limpiar | Baja |
| Bloques sin iconos diferentes | Todos los bloques con el mismo icono | Baja |
| Instancias Picking en Supabase | Muchas `inst-t-1778445167981-...` con `parent_task_id` guardadas — limpiar con SQL | Baja |
| Completar tarea padre en Bloques | Cuando todas las hijas están completadas, poder completar el contenedor | Media |
| Buscador en Vista Bloques | El buscador de la parte superior no funciona | Media |
| Barra de selección flotante | La barra (Delegar/Fecha/Completar/Duplicar/Eliminar) queda arriba, hay que scrollear. Mejorar posición y experiencia de selección | Media |

---

## 12. Reglas de Negocio

1. Templates nunca aparecen en Dashboard
2. Subtareas nunca aparecen solas
3. Contenedores NUNCA tienen `dueDate`
4. Contenedores NUNCA tienen `recurrence`
5. Contenedores son comparsa — sin fecha, recurrencia, tiempo, delegación, tags
6. Delegadas sin tag real se ocultan del Dashboard y stats
7. Contenedor desaparece cuando todas sus subtareas del día están completadas
8. Instancias normales no se guardan en Supabase — solo excepciones
9. `order` persiste en Supabase
10. Zona horaria: Barcelona UTC+2. `formatLocalISO` evita desfases.
11. Colores condicionales: inline styles hex, nunca Tailwind dinámico
12. **Delegadas solo muestra templates y manuales** — no instancias ni excepciones
13. **RecurrencePickerChip solo editable en manuales** — en templates/instancias es solo informativo
14. **Recurrencia solo se edita desde Bloques**

---

## 13. Workflow de Desarrollo

```
1. Abrir CMD como administrador (no PowerShell)
2. cd "C:\Users\Israe\OneDrive\Escritorio\workmanager-v19"
3. npm run dev → http://localhost:3001
4. GitHub Desktop: commit → push origin master → Vercel despliega
```

---

## 14. Notas para el Asistente

- **Siempre pedir el archivo antes de modificarlo**
- **Verificar en Supabase con SQL** antes de asumir que es problema de código
- **La tabla tasks NO tiene columna `subtasks`** — es array reconstruido en memoria
- **`hasSubtasks` en TaskCard** filtra instancias (`inst-...`)
- El TaskModal está en App.tsx (no en components.tsx)
- `generation.worker.ts` es archivo separado en src/ (no import normal)
- Logs debug pendientes de limpiar: `[PICKING DEBUG]`, `[CHIP DEBUG]`, `[CHIP RENDER]`, `[STATS DEBUG]`
- `useSupabaseData.ts` es legacy — no tocar
- El Worker recibe copia serializada de `tasks` — no accede al estado React
- **Un bug a la vez**

---

## 15. Ideas Pendientes

1. **Completado con descarte** — `wasDiscarded:true`, X en vez de tick. Requiere columna en Supabase.
2. **Tag "bloqueada"** — Tarea oculta hasta activarse manualmente.
3. **WorkManager Assistant** — Agente Relevance AI integrado via Vercel serverless (construido, no funcional).
