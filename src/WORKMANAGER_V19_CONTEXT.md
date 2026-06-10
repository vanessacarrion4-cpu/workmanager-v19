# WorkManager v19 — Documento de Contexto Completo

> Usar este documento al inicio de cada sesión de desarrollo para dar contexto completo al asistente.
> Última actualización: 09/06/2026 (sesión 8 — WeekView tiempo, añadir subtarea desde Dashboard, filtros, TaskModal subtareas)

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
├── App.tsx                      # Estado global, hooks, routing entre vistas
├── types.ts                     # Interfaces TypeScript: Task, WorkBlock, TimeEntry, Person, etc.
├── constants.ts                 # INITIAL_BLOCKS, COLORS, TAG_LABELS
├── supabaseClient.ts            # Inicialización cliente Supabase
├── dateUtils.ts                 # formatLocalISO(), parseLocalISO()
├── utils.ts                     # generateInstances(), isTaskCompleted(), projectLoad(), etc.
├── filters.ts                   # filterTasksForDay(), groupTasksByTag(), getStatsForDay()
├── helpers.ts                   # getTagColor() y funciones helper compartidas
├── useSupabase.ts               # Hook: carga inicial desde Supabase + reparaciones automáticas
├── useGeneration.ts             # Hook: genera instancias recurrentes via Web Worker
├── useTaskCRUD.ts               # Hook: handleAddTask, doAddTask, handleUpdateTask, handleDeleteTask, handleToggleStatus, handleAddRule
├── useTaskOrdering.ts           # Hook: handleUpdateTasksOrder, handleUpdateSubtasksOrder, handleGoToTemplate, expand/collapse, promote/demote
├── useBlockHandlers.ts          # Hook: CRUD de bloques de trabajo
├── useTimerHandlers.ts          # Hook: cronómetro, tiempo manual, adjuntos
├── useBulkActions.ts            # Hook: bulkUpdateTasks, bulkDeleteTasks, bulkDuplicateTasks
├── generation.worker.ts         # Web Worker: ejecuta generateInstances en hilo separado
├── useSupabaseData.ts           # Hook legacy (no usar)
├── TaskModal.tsx                # Modal de configuración de tarea
├── StickyActionBar.tsx          # Barra de acciones sticky compartida entre vistas
├── DashboardView.tsx            # Vista principal del día
├── BlocksView.tsx               # Vista de gestión de bloques y tareas (templates)
├── CalendarView.tsx             # Vista de calendario mensual con carga por día
├── DelegadasView.tsx            # Vista de tareas delegadas por persona
├── SearchView.tsx               # Búsqueda global de tareas con filtros
├── WorkloadView.tsx             # Vista de carga de trabajo por bloques
├── WeekView.tsx                 # Vista semanal
├── TaskCard.tsx                 # Componente principal de tarjeta de tarea
├── Chips.tsx                    # Todos los chips inline: DelegationChip, DatePickerChip, RecurrencePickerChip, etc.
├── Modals.tsx                   # RecurrenceChoiceModal, BlockModal, InstancesModal
├── TimeComponents.tsx           # TimerDisplay, TimeManagementPanel, MonthDatePicker
├── DashboardComponents.tsx      # DashboardHarmonicCalendar, BulkActionBar, ToggleExpandButton
├── components.tsx               # Barrel re-export de todos los componentes (~16 líneas)
├── main.tsx                     # Entry point React (StrictMode)
└── index.css                    # Tailwind + scrollbar custom dark/light
```

**IMPORTANTE**:
- `TaskModal` está en `TaskModal.tsx`, NO en `components.tsx` ni en `App.tsx`
- `components.tsx` es solo barrel — todos los imports desde `'./components'` siguen funcionando
- `useSupabaseData.ts` es legacy — no tocar
- `WeekView.tsx` importado en App.tsx

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

**CRÍTICO time_entries**: La columna `task_id` en `time_entries` **NO tiene FK activa** contra `tasks`. Se puede guardar cualquier ID — incluyendo IDs de instancias (`inst-t-xxx-fecha`). NO usar `resolveIdForDB` al guardar tiempo manual. Guardar el `taskId` tal cual llega.

**NOTA tasks**: La tabla `tasks` NO tiene columna `updated_at`. Solo tiene `created_at` y `modified_at`.

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
  blockId: string
  title: string
  status: 'pending' | 'completed'
  dueDate: string | null      // YYYY-MM-DD. NUNCA en contenedores.
  dueTime?: string            // HH:mm
  tags: TagType[]             // 'con_hora' | 'focus' | 'dirección' | 'espera' | 'resto'
  priority: 'alta' | 'media' | 'baja'
  estimatedMinutes: number
  parentTaskId?: string
  subtasks?: string[]         // IDs hijos (reconstruido en memoria)
  isTemplate?: boolean
  templateId?: string
  instanceDate?: string
  isException?: boolean
  recurrence?: { ... }
  isDeleted?: boolean
  isActive?: boolean
  isExpanded?: boolean
  wasRecurring?: boolean
  existsInSupabase?: boolean
  delegation?: { personId: string, delegatedAt: string }
  attachments?: Attachment[]
  taskType?: 'core' | 'adhoc'
  order: number
  notes?: string
  completedAt?: string | null
}
```

**IDs de instancia**: formato `inst-{templateId}-{YYYY-MM-DD}` o `inst-{templateId}-{subId}-{YYYY-MM-DD}`.
Para extraer el templateId de una instancia: `id.replace(/^inst-/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '')`

---

## 5. Arquitectura de Recurrencia — CRÍTICO

### Reglas CRÍTICAS
1. Los **contenedores** NUNCA tienen `recurrence`, `dueDate`, `dueTime`, `tags`, ni `delegation`
2. La **recurrencia va solo en las subtareas** (nivel 2)
3. Las **instancias normales NO se guardan** en Supabase — se regeneran en memoria
4. Solo se guardan si `isException: true` (modificadas individualmente)
5. `useGeneration` solo modifica instancias (`templateId` presente), **NUNCA** templates
6. **Recurrencia anual**: usa `yearDay` + `yearMonth`

### IDs de instancia de contenedor
Los contenedores también generan instancias: `inst-t-{timestamp}-{subId}-{YYYY-MM-DD}`.
El templateId del contenedor es `t-{timestamp}-{subId}` (con letras, no solo números).
El regex `/^inst-(t-\d+)/` es INCORRECTO para estos IDs.
Usar siempre: `parentTaskId.replace(/^inst-/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '')`

---

## 6. Flujo de Carga al Iniciar (useSupabase.ts)

1. Carga `work_blocks`, `persons`, `time_entries`, `meetings`
2. Carga `tasks` con paginación (chunks de 1000 — límite Supabase)
3. `reconstructHierarchy` reconstruye `subtasks[]` desde `parent_task_id`
4. `repairContainersWithForbiddenData` limpia datos inválidos en contenedores
5. `useGeneration` genera instancias recurrentes via Web Worker (ventana ±60 días)

---

## 7. Sistema de Tipos de Tarea

- `taskType: 'core' | 'adhoc'` — propiedad directa de cada tarea y contenedor
- **Todos los contenedores tienen `taskType`** — no hay que inferirlo
- **Todas las subtareas tienen `taskType`** — directo en la tarea
- En WeekView: `getEffectiveType(task)` usa `task.taskType || 'core'` (igual que WorkloadView)
- Default siempre es `'core'` cuando `taskType` es null/undefined

---

## 8. WeekView — Arquitectura

### Agrupación
- Dropdown en header con 4 modos: **Bloque** (default) / **Tipo** / **Bloque→Tipo** / **Tipo→Bloque**
- Toggle **Carga** (morado): desglose Core/Adhoc con barra proporcional
- Toggle L-V / L-D + navegación semanas + jump to date

### Filtrado de tareas por día
- Solo raíces (`!parentTaskId`) — subtareas nunca aparecen solas
- Dentro de ventana ±60 días: `filterTasksForDay` con `hideCompleted: false`
- Fuera de ventana: `generateVirtualInstances` + manuales sin templateId

### Tiempo por día (`getTaskMins(task, allTasksMap, date)`)
- Tarea hoja: `task.estimatedMinutes`
- Contenedor: suma subtareas con `dueDate === date` Y `dueDate !== null`
- Subtareas sin `dueDate` no se suman para ningún día
- `WeekTaskCard` recibe `date` prop del día en que se renderiza (no `task.dueDate` del contenedor)

### Colapsado
- Modo Bloque→Tipo: bloque colapsable → subgrupos tipo colapsables (contraídos por defecto)
- Modo Tipo→Bloque: tipo colapsable → subgrupos bloque colapsables (contraídos por defecto)

---

## 9. Registro de Tiempo Inline (Chips.tsx)

### RegisteredTimeChip
- **Con `onAddEntry`** (Dashboard): abre popover inline
- **Sin `onAddEntry`** (otras vistas): abre TaskModal via `onClick`

### Popover inline
- **Presets** (15m, 30m, 45m, 1h, 1.5h, 2h): clic directo registra y cierra
- **Input manual**: escribir + Enter o botón ✓
- **Toggle "Marcar completada"**: afecta al registro
- **"Más opciones →"**: cierra popover y abre TaskModal completo

### Cadena de props
```
App.tsx → DashboardView (onAddTimeEntry) → TaskCard (onAddTimeEntry) → TaskCard recursivo (onAddTimeEntry) → RegisteredTimeChip (onAddEntry)
```
**CRÍTICO**: El TaskCard recursivo TAMBIÉN debe recibir `onAddTimeEntry`.

---

## 10. Añadir Subtarea desde Dashboard — CRÍTICO (sesión 8)

### El problema
Cuando el contenedor en el Dashboard es una **instancia** (`inst-t-xxx-subId-fecha`), crear subtareas tiene varias complejidades.

### Solución implementada

**useTaskCRUD.ts — `handleAddTask` y `doAddTask`:**
- Extraer templateId de instancia: `parentTaskId.replace(/^inst-/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '')`
- `effectiveParentId` = templateId (para que la subtarea quede bajo el template)
- `isTemplate = false` cuando `parentTaskId !== effectiveParentId` (venimos de instancia)
- `dueDate = overrideDate || activeDate` (siempre tiene fecha)
- En Supabase: `parent_task_id` = templateId resuelto

**filters.ts — `getVisibleSubtasksForDay`:**
- Antes excluía subtareas manuales con `parentTaskId === containerTemplateId` si el contenedor era instancia
- Ahora las permite si tienen `dueDate` (son subtareas creadas manualmente ese día)

**App.tsx — `dashboardTasksMap`:**
- Incluye subtareas manuales del template con `dueDate === activeDate` y sin `templateId`

**TaskModal.tsx — `+ AÑADIR`:**
- Pasa `overrideDate = localTask.dueDate || localTask.instanceDate` a `onAddTask`
- Actualiza `localTask.subtasks` inmediatamente (prepend) para mostrar en modal
- `subtasks` useMemo tiene fallback para tareas no aún en `allTasksMap`
- Títulos de subtareas en estado local (`subtaskTitles`) — guarda en `onBlur` para evitar re-render

### Flujo inline del Dashboard
1. Pulsar `+` en contenedor → `e.stopPropagation()` + `onAddTask(inst-id, blockId)`
2. `doAddTask` resuelve inst→template, crea con `dueDate=activeDate`, `isTemplate=false`
3. `setTimeout(() => setInlineEditingTaskId(id), 50)` — delay para que React renderice primero
4. Aparece en "Sin etiqueta" del Dashboard con editor inline

---

## 11. TaskModal — Subtareas

### Estado local de títulos
```ts
const [subtaskTitles, setSubtaskTitles] = useState<Record<string, string>>({});
```
- Input de título usa `subtaskTitles[st.id]` mientras edita
- Guarda en Supabase solo en `onBlur` o Enter — evita re-render por tecla
- Al crear nueva subtarea: `setLocalTask(prev => ({ ...prev, subtasks: [nid, ...prev.subtasks] }))` → aparece arriba inmediatamente

---

## 12. TimeManagementPanel (TimeComponents.tsx)

- **Cerrar** siempre visible en la barra de tabs
- **Registrar** llama `onClose()` después de guardar

---

## 13. useBulkActions

- `activeDate` se pasa como prop desde App.tsx
- Solo mueve subtareas con `dueDate === activeDate` y `status !== 'completed'`

---

## 14. Reglas de Negocio

1. Templates nunca aparecen en Dashboard
2. Subtareas nunca aparecen solas
3. Contenedores NUNCA tienen `dueDate`
4. Contenedores NUNCA tienen `recurrence`
5. Contenedores son comparsa — sin fecha, recurrencia, tiempo, delegación, tags
6. Delegadas sin tag real se ocultan del Dashboard y stats
7. Contenedor desaparece cuando todas sus subtareas del día están completadas
8. Instancias normales no se guardan en Supabase — solo excepciones
9. `order` persiste en Supabase
10. Zona horaria: Barcelona UTC+2. `formatLocalISO` evita desfases
11. Colores condicionales: inline styles hex, nunca Tailwind dinámico
12. **Delegadas solo muestra templates y manuales** — no instancias ni excepciones
13. **RecurrencePickerChip solo editable en manuales** — en templates/instancias es solo informativo
14. **Recurrencia solo se edita desde Bloques**
15. **time_entries**: guardar taskId tal cual — sin resolver a templateId
16. **Bulk fecha**: solo mueve subtareas pendientes del día activo — nunca completadas ni de otro día
17. **Subtareas manuales creadas desde Dashboard**: `parentTaskId` → template, `dueDate` → activeDate, `isTemplate` → false

---

## 15. Bugs Resueltos — Sesión 8 (09/06/2026)

| # | Descripción | Archivos |
|---|-------------|---------|
| — | WeekView: tiempo correcto — subtareas sin dueDate no se suman | `WeekView.tsx` |
| — | WeekView: `getTaskMins` recibe `date` del día renderizado, no `task.dueDate` | `WeekView.tsx` |
| — | Añadir subtarea desde Dashboard con contenedor recurrente | `useTaskCRUD.ts`, `filters.ts`, `App.tsx`, `TaskModal.tsx`, `TaskCard.tsx` |
| — | `+ AÑADIR` del modal muestra subtarea inmediatamente y permite escribir | `TaskModal.tsx` |
| — | Regex correcto para extraer templateId de instancia de contenedor | `useTaskCRUD.ts` |
| — | `filters.ts`: permitir subtareas manuales con dueDate bajo contenedor instancia | `filters.ts` |
| — | `dashboardTasksMap`: incluir subtareas manuales del template con dueDate===activeDate | `App.tsx` |

## Bugs Resueltos — Sesión 7 (08/06/2026)

| # | Descripción | Archivos |
|---|-------------|---------|
| — | WeekView: dropdown agrupación (Bloque/Tipo/Bloque→Tipo/Tipo→Bloque) | `WeekView.tsx` |
| — | WeekView: tipo correcto — `task.taskType \|\| 'core'` directo | `WeekView.tsx` |
| — | TaskModal: botón "Ir a bloques" en header | `TaskModal.tsx`, `App.tsx` |
| — | TimeComponents: Cerrar siempre visible, Registrar cierra panel | `TimeComponents.tsx` |
| — | Bulk fecha: no mover subtareas completadas ni de otros días | `useBulkActions.ts`, `App.tsx` |
| — | Dashboard: 61 tareas con due_date erróneo 9/6 — corregidas via SQL | Supabase SQL |
| — | Re-render contenedor al completar subtarea | `useTaskCRUD.ts` |
| — | RegisteredTimeChip: popover inline con presets | `Chips.tsx`, `TaskCard.tsx`, `DashboardView.tsx`, `App.tsx` |

---

## 16. Bugs / Mejoras Pendientes

| # | Descripción | Archivo | Notas |
|---|-------------|---------|-------|
| 7 | Limpiar instancias Picking en Supabase | Supabase SQL | Verificar con SELECT primero |
| B1 | Bug: completado no persiste tras recarga | `useTaskCRUD.ts` / `useSupabase.ts` | Identificado, no resuelto |
| HR | DPTs y Guía Operativa payroll | Docs HR | Pendiente redactar |

---

## 17. Workflow de Desarrollo

```
1. Abrir CMD como administrador (no PowerShell)
2. cd "C:\Users\Israe\OneDrive\Escritorio\workmanager-v19"
3. npm run dev → http://localhost:3001
4. GitHub Desktop: commit → push origin master → Vercel despliega
```

---

## 18. Notas para el Asistente

- **Siempre pedir el archivo antes de modificarlo**
- **Verificar en Supabase con SQL** antes de asumir que es problema de código
- **La tabla tasks NO tiene columna `subtasks`** — es array reconstruido en memoria
- **La tabla tasks NO tiene columna `updated_at`** — solo `created_at` y `modified_at`
- El TaskModal está en `TaskModal.tsx`
- `generation.worker.ts` es archivo separado en src/ (no import normal)
- `useSupabaseData.ts` es legacy — no tocar
- El Worker recibe copia serializada de `tasks` — no accede al estado React
- **Un bug a la vez**
- Preferencia: archivos completos de reemplazo, no edits parciales
- El div raíz de App.tsx DEBE ser `h-screen overflow-hidden`
- La StickyActionBar DEBE estar en App.tsx fuera del scroll container
- Color turquesa oficial: `#14B8A6`
- **`time_entries` NO tiene FK activa** — guardar taskId tal cual
- **`filterTasksForDay` firma**: `(tasks, allTasksMap, activeBlockIds: Set<string>, activeDate, options)`
- **NUNCA usar `/^inst-(t-\d+)/` para extraer templateId** — los templateId de contenedores tienen letras
- **Regex correcto**: `id.replace(/^inst-/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '')`
- **RegisteredTimeChip**: pasar `onAddTimeEntry` también en TaskCard recursivo
- **Todos los contenedores y subtareas tienen `taskType`** — usar `|| 'core'` como default

---

## 19. Ideas Pendientes

1. **Barra ghost** — StickyActionBar que aparece solo al scrollear
2. **Completado con descarte** — `wasDiscarded:true`, X en vez de tick. Requiere columna en Supabase
3. **Tag "bloqueada"** — Tarea oculta hasta activarse manualmente
4. **WorkManager Assistant** — Agente Relevance AI integrado via Vercel serverless (construido, no funcional)
5. **Migración esmeralda completa** — actualmente `turquesa` y `esmeralda` son el mismo valor `#14B8A6`
6. **WeekView mejoras**: ocultar completadas toggle, reordenar días con drag, mover tarea entre días
7. **Presets tiempo en WeekView** — registrar tiempo directamente desde WeekTaskCard
