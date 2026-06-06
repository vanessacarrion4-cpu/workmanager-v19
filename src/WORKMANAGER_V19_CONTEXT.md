# WorkManager v19 — Documento de Contexto Completo

> Usar este documento al inicio de cada sesión de desarrollo para dar contexto completo al asistente.
> Última actualización: 06/06/2026

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

## 2. Estructura de Archivos (`src/`)

```
src/
├── App.tsx                    # Componente raíz (~3700 líneas). Estado global, handlers, routing entre vistas
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
├── components.tsx             # Todos los componentes reutilizables (~2900 líneas)
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
    frequency: 'daily' | 'weekdays' | 'weekly' | 'monthly'
    weekDays?: number[]       // [0=lunes...6=domingo]
    monthDay?: number         // 1-31
    startDate: string         // YYYY-MM-DD
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
Cuando el usuario modifica una instancia concreta (cambia fecha, completa, edita):
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

---

## 6. Flujo de Carga al Iniciar (useSupabase.ts)

1. Carga `work_blocks`, `persons`, `time_entries`, `meetings`
2. Carga `tasks` con filtro: `template_id IS NULL OR is_exception = true`
   - Solo carga templates/manuales + excepciones
   - Las instancias normales se generan en memoria después
   - **Paginación**: PAGE_SIZE=1000 para superar límite PostgREST
3. Reconstruye jerarquía en **3 pasadas**:
   - `reconstructHierarchy`: parentTaskId → subtasks[]
   - `reconstructInstanceHierarchy`: reconstruye padre de excepciones sin FK
   - `reconstructExceptionContainerSubtasks`: vincula subtareas a contenedores excepción
4. **Reparaciones automáticas**:
   - `repairContainersWithForbiddenData`: limpia dueDate/tags en templates
   - `repairRecurringContainers`: asegura isTemplate:true en contenedores con hijos recurrentes
5. Limpieza: borra de Supabase instancias `is_deleted:true` de más de 30 días
6. Llama `setIsDataLoaded(true)`

---

## 7. Flujo de Generación de Instancias (useGeneration.ts + generation.worker.ts)

### Cuándo se ejecuta
Solo cuando cambia `templateKey` (clave calculada solo de templates reales, sin `modifiedAt`).
Protección contra bucle infinito: máximo 20 ciclos.

### Ventana de generación
- `DAYS_PAST = 30` (1 mes atrás)
- `DAYS_FUTURE = 60` (2 meses adelante)

### Proceso
1. Limpia instancias en memoria fuera de la ventana (excepto `isException` y `existsInSupabase`)
2. Envía templates al **Web Worker** (hilo separado, no bloquea UI)
3. Worker ejecuta `generateInstances()` y devuelve instancias
4. **PASO 1**: Añade instancias nuevas que no existen
5. **PASO 2**: Merge de subtasks para contenedores existentes en Supabase
6. **PASO 3**: Vincula subtareas generadas a sus contenedores padre
7. Early return si `newInstances.length === 0 && !needsMerge`

### Lógica de generateInstances (generation.worker.ts) — FIXES RECIENTES
```typescript
// Para cada subtarea en el bucle:

// 1. PRIMERO: ¿hay excepción movida A este día?
const movedExceptionToday = allTasks.find(t =>
  t.templateId === childTemplate.id && t.isException &&
  t.dueDate === dateStr && !t.isDeleted
);
if (movedExceptionToday) { subtaskInstanceIds.push(movedExceptionToday.id); return; }

// 2. ¿fue movida DESDE este día?
const movedAwayException = allTasks.find(t =>
  t.templateId === childTemplate.id && t.isException &&
  t.instanceDate === dateStr && t.dueDate !== dateStr && !t.isDeleted
);
if (movedAwayException) return; // No generar para este día

// 3. Después: filtros normales de recurrencia
```

También: `shouldAppear` incluye `hasExceptionMovedToThisDay` para que el contenedor
padre aparezca en días a los que se moverón subtareas (aunque no tengan recurrencia ese día).

---

## 8. Handlers Principales (App.tsx)

### `handleToggleStatus(taskId)`
- Togglea `pending` ↔ `completed` recursivamente (padre + todas las subtareas)
- Para instancias: **upsert completo** en Supabase con `is_exception:true`
- Para tareas normales: `update` simple de `status` y `completed_at`
- Marca `wasRecurring:true` al completar si era recurrente (informativo)

### `handleUpdateTask(updatedTask)`
- Si la fecha cambia en una instancia con padre (`isException` detectado):
  1. Soft-delete de la instancia antigua en Supabase
  2. Upsert de nueva instancia con nueva fecha (`_newSubtaskId`) en Supabase
  3. Crea/actualiza instancia padre en el nuevo día (en memoria)
  4. **CRÍTICO**: La instancia padre modificada también necesita `isException:true` para persistir
- Para cambios sin fecha: upsert completo si es instancia, update simple si es template/manual
- Llama `setEditingTaskId(null)` y `setInlineEditingTaskId(null)` al terminar

### `handleAddTask(parentTaskId, blockId, overrideDate, defaultPersonId)`
- Crea nueva tarea con `id: t-{Date.now()}`
- `setTimeout(() => setEditingTaskId(id), 50)` — abre modal con delay para evitar race condition
- Si crea subtarea en contenedor recurrente → aviso para quitar fecha del padre

### `handleDeleteTask(taskId)`
- Soft delete recursivo (tarea + subtareas)
- Para instancias: `upsert` con `is_deleted:true, is_exception:true`
- Para templates: borra también todas las instancias en memoria

### `handlePromoteTask(taskId)` / `handleDemoteTask(taskId)`
- Reubica tarea en la jerarquía (sube/baja un nivel)
- Persiste `parent_task_id` en Supabase

### `handleUpdateTasksOrder(orderedTasks)` / `handleUpdateSubtasksOrder(parentId, subtaskIds)`
- Persiste `order` en Supabase para cada tarea

### `bulkUpdateTasks(updates)`
- Modo selección múltiple: aplica cambios a todas las tareas seleccionadas
- Para contenedores: aplica a sus subtareas visibles, no al contenedor

---

## 9. Filtrado — filters.ts

### `filterTasksForDay(tasks, allTasksMap, activeBlockIds, activeDate, options)`
**Excluye siempre**: borradas, templates, subtareas solas, bloques inactivos, delegadas sin tag real
**Incluye**:
- Tarea/instancia con `dueDate === activeDate`
- Contenedor sin `dueDate` con ≥1 subtarea pendiente ese día

**IMPORTANTE**: Un contenedor NUNCA debe tener `dueDate`. Si lo tiene, entra por la rama de fecha en lugar de la de contenedor y puede no mostrar sus subtareas.

### `getVisibleSubtasksForDay(container, allTasksMap, activeDate, options)`
Dos caminos:
- **Caso 1** (recurrentes): busca por `subtaskTemplate.parentTaskId === containerTemplateId`
- **Caso 2** (manuales): busca por `parentTaskId === container.id`

### `getStatsForDay(dayTasks, allTasksMap, timeEntries, activeDate)`
- Solo cuenta tareas hoja (sin subtareas)
- Usa `hideDelegatedNoTag:true` para consistencia con el Dashboard

---

## 10. Guardado en Supabase — Patrones Clave

### Instancia vs template en upsert
```typescript
// Siempre para instancias:
parent_task_id: null,          // FK constraint — jerarquía se reconstruye via templateId
template_id: t.templateId,
instance_date: t.instanceDate || null,
is_template: false,
is_exception: true,            // Siempre true para instancias guardadas
recurrence: null,              // Las instancias NO tienen recurrence
```

### Time entries con instancias recurrentes
```typescript
// Las instancias tienen IDs "inst-t-xxx-2026-06-01"
// Estos IDs NO existen en Supabase → error FK al guardar time_entry
// Fix: resolver templateId antes de guardar
const resolveIdForDB = (id: string) => {
  if (!id.startsWith('inst-')) return id;
  const task = tasks[id];
  return task?.templateId || id;
};
```

### Colores condicionales: SIEMPRE inline styles
```typescript
// CORRECTO: inline style con hex
style={{ color: '#14B8A6' }}

// INCORRECTO: Tailwind dinámico (no funciona en producción)
className={`text-${color}-500`}
```

---

## 11. Componentes Clave (components.tsx)

| Componente | Descripción |
|------------|-------------|
| `TaskCard` | Tarjeta de tarea. Variantes COMPACT/FULL. Chips de info. |
| `TimeManagementPanel` | Panel registro de tiempo. Compactado ~30%. |
| `RegisteredTimeChip` | Chip tiempo registrado. **Colores inline**: turquesa (ok), naranja (≥90%), rosa (excedido), gris (0m). |
| `RecurrencePickerChip` | Selector recurrencia con **estado local** (`localValue`). `onChange` solo al cerrar popup para no disparar `useGeneration`. |
| `TimerStopModal` | Modal al parar cronómetro (reemplaza `prompt()` nativo). |
| `BlockModal` | Modal creación/edición de bloques. |
| `RecurrenceChoiceModal` | "¿Editar solo esta instancia o todas?" |
| `TaskModal` | **En App.tsx**, no en components.tsx. |

---

## 12. Vistas

### Dashboard (DashboardView.tsx)
- Vista del día activo con navegación por fechas
- Tareas agrupadas por tag: Con Hora, Focus, Dirección, En Espera, Resto
- Stats: tareas completadas, tiempo estimado pendiente, tiempo registrado
- Drag & drop con `Reorder` de framer-motion (persiste order a Supabase)
- ⚠️ Hay logs `[STATS DEBUG]` pendientes de limpiar

### Bloques (BlocksView.tsx)
- Gestión de templates con subtareas recurrentes
- Vista de árbol con drag & drop
- **Desde aquí NO se pueden completar tareas** — son plantillas, no instancias

### Calendario (CalendarView.tsx)
- Vista mensual con indicadores de carga por día
- Color coding por umbrales de minutos: esmeralda/naranja/morado/rosa
- Solo muestra carga en días presentes/futuros (pasados = 0)

### Delegadas (DelegadasView.tsx)
- Accordion por persona con sus tareas asignadas
- Sistema de reuniones con notas formateadas
- Flechitas ▲▼ para reordenar (persiste a Supabase)

### Búsqueda (SearchView.tsx)
- Filtros: tags, status, taskType, fechas, recurrencia, tiempo estimado

### Carga de Trabajo (WorkloadView.tsx)
- Usa `projectLoad()` de utils.ts
- Genera instancias localmente sin tocar estado global

---

## 13. Bugs Resueltos — Historial Completo

### ✅ Sesiones anteriores a 06/06/2026
1. PostgREST límite 1000 filas → paginación en `useSupabase`
2. Time entries FK error con instancias → `resolveIdForDB()`
3. `repairContainersWithForbiddenData` borraba datos normales → guard `isTemplate`
4. Tareas duplicadas por instancias excepción con `due_date=null`
5. Notas no persistían → `useEffect([task.id])` en TaskModal
6. Timer stop usaba `prompt()` → `TimerStopModal`
7. Drag & drop en Dashboard, Bloques y Delegadas
8. Adjuntos no persistían → fix upsert y mapeo en useSupabase
9. Bloqueo UI al añadir recurrencia → Web Worker + `DAYS_FUTURE:60`
10. Subtareas duplicadas (template + instancia mismo día) → `if (task.isTemplate) return false` en `getVisibleSubtasksForDay`
11. Subtarea manual duplicada en contenedor con instancia → excluir manuales que apuntan al template
12. `handleClose` not defined en varios chips → `onClick={() => setShow(false)}`
13. Stats contaban delegadas sin tag → `hideDelegatedNoTag:true` en `getStatsForDay`
14. `RegisteredTimeChip` invisible en light mode → estilos inline con hex
15. Modales demasiado grandes → TaskModal y TimeManagementPanel compactados
16. Contenedor con `dueDate` propio no aparecía en Dashboard → los contenedores nunca deben tener fecha
17. `motion/react` no resolvía en build → `npm install motion`

### ✅ Resueltos en sesión 06/06/2026
18. **Cambio de fecha de instancia no persistía tras reload** — `handleUpdateTask` no guardaba en Supabase. Fix: añadir upsert de la nueva instancia (`_newSubtaskId`) con `is_exception:true`
19. **Instancia volvía al día original tras reload** — `generation.worker.ts` regeneraba la instancia del día original ignorando la excepción. Fix: check `movedAwayException` (instanceDate=dayOriginal, dueDate≠dayOriginal) antes de generar subtarea
20. **Instancia movida no aparecía en el día nuevo** — `shouldAppear` no incluía excepciones movidas a ese día. Fix: `hasExceptionMovedToThisDay` en `shouldAppear` + check `movedExceptionToday` antes del filtro de recurrencia en el bucle de subtareas

---

## 14. Bugs Pendientes

| Bug | Síntoma | Prioridad |
|-----|---------|-----------|
| Tareas completadas no desaparecen del Dashboard | Al marcar como completada, sigue visible (no persiste tras reload) | Alta |
| Nivel 3 sin indentación visual | Sub-subtareas visualmente iguales a nivel 2 | Media |
| Vista bloques — lista no cards | Las tareas se muestran como cards grandes en vez de lista compacta | Media |
| Recurrentes repetidas en vista bloque | Una tarea recurrente aparece múltiples veces | Media |
| Bloques sin iconos diferentes | Todos los bloques con el mismo icono | Baja |
| Logs debug en DashboardView | `[STATS DEBUG]` pendientes de limpiar | Baja |

---

## 15. Reglas de Negocio

1. **Templates nunca aparecen en Dashboard** — `isTemplate:true` los bloquea en `filterTasksForDay`
2. **Subtareas nunca aparecen solas** — Solo bajo su contenedor padre
3. **Los contenedores NUNCA tienen `dueDate`** — Solo sus subtareas tienen fecha
4. **Los contenedores NUNCA tienen `recurrence`** — La recurrencia va en las subtareas
5. **Los contenedores son comparsa** — Sin fecha, sin recurrencia, sin tiempo, sin delegación, sin tags propios
6. **Delegadas sin tag real se ocultan** del Dashboard y stats (`hideDelegatedNoTag`)
7. **Contenedor desaparece** cuando todas sus subtareas del día están completadas
8. **Instancias normales no se guardan** en Supabase — solo las excepciones
9. **`order` persiste en Supabase** via `handleUpdateTasksOrder` / `handleUpdateSubtasksOrder`
10. **Zona horaria**: Barcelona UTC+2 (verano). `formatLocalISO` evita desfases de UTC.
11. **Colores condicionales**: siempre inline styles hex, nunca Tailwind dinámico

---

## 16. Convenciones de IDs

| Tipo | Formato | Ejemplo |
|------|---------|---------|
| Tarea manual / template | `t-{Date.now()}` | `t-1778617274921` |
| Instancia generada | `inst-{templateId}-{YYYY-MM-DD}` | `inst-t-1778445069239-2026-06-01` |
| Time entry | `te-{Date.now()}` | `te-1778617274921` |
| Adjunto | `att-{Date.now()}` | `att-1778617274921` |
| Bloque inicial | `b{n}` | `b1`, `b2` |
| Bloque nuevo | `b-{timestamp}` | `b-1778617274921` |

---

## 17. Bloques de Trabajo

| ID | Nombre | Color |
|----|--------|-------|
| b1 | Cuadro de Mando | Turquesa |
| b2 | Contabilidad central | Azul |
| b3 | Contabilidad Franquis | Morado |
| b4 | Bancos | Naranja |
| b5 | Contratos | Rosa |
| b6 | Finca | Lima |
| b7 | RRHH | Azul |
| b8 | ERP | Turquesa |
| b10 | Seguros | Rosa |

---

## 18. Tags

| Tag | Label | Uso |
|-----|-------|-----|
| `con_hora` | Con Hora | Tareas con hora fija |
| `focus` | Focus | Tareas prioritarias de concentración |
| `dirección` | Dirección | Decisiones estratégicas |
| `espera` | En Espera | Seguimiento esperando respuesta externa |
| `resto` | Resto | Sin clasificar (default) |

---

## 19. Supabase Storage — Adjuntos

- **Bucket**: `task-attachments` (público)
- **Columna**: `attachments JSONB DEFAULT '[]'` en tabla tasks
- **Path**: `{taskId}/{timestamp}.{ext}`
- Las imágenes se muestran como miniatura en el modal

---

## 20. Variables de Entorno (Vercel)

```
VITE_SUPABASE_URL=https://yewfmfoljidvrxvbrsdv.supabase.co
VITE_SUPABASE_ANON_KEY={clave anon de Supabase}
```

---

## 21. Workflow de Desarrollo

```
1. Abrir CMD como administrador (no PowerShell)
2. cd "C:\Users\Israe\OneDrive\Escritorio\workmanager-v19"
3. npm run dev → http://localhost:3001
4. Editar archivos en src/
5. GitHub Desktop: git add -A → commit → push origin master
6. Vercel despliega automáticamente
```

### Limpiar localStorage (si hay problemas)
```javascript
// F12 → Console → escribir letra por letra:
localStorage.clear()
// Enter → F5
```

### Restaurar versión anterior desde Git
```bash
git log --oneline -10                          # Ver commits
git show {commitHash}:src/App.tsx > src/App.tsx  # Restaurar archivo concreto
```

---

## 22. Notas para el Asistente

- **Siempre pedir el archivo antes de modificarlo** — No asumir versión
- **Verificar en Supabase con SQL** antes de asumir que el problema es de código
- **App.tsx tiene ~3700 líneas** — buscar funciones por nombre antes de editar
- **El TaskModal está en App.tsx** (no en components.tsx)
- **`generation.worker.ts`** es un archivo separado en `src/` (no es un import normal)
- **Colores condicionales**: inline styles con hex, nunca Tailwind dinámico
- **`dark:` prefix primero** en classNames con variante dark/light
- Los logs `[STATS DEBUG]` en DashboardView.tsx deben limpiarse en algún momento
- `useSupabaseData.ts` es legacy — no se usa activamente, no tocar
- El Worker recibe una copia de `tasks` serializada — no puede acceder al estado React directamente
- **Un bug a la vez** — confirmar que funciona antes de pasar al siguiente

---

## 23. Ideas Pendientes (no implementadas)

1. **Completado con descarte** — Tercer estado visual (`wasDiscarded:true`). X en lugar de tick. Requiere columna `was_discarded` en Supabase.
2. **Tag "bloqueada"** — Tarea que no aparece en Dashboard hasta activarse manualmente. Aviso al completar tarea hermana si hay subtareas bloqueadas.
3. **WorkManager Assistant** — Agente Relevance AI integrado via Vercel serverless endpoints (construido pero no totalmente funcional).
