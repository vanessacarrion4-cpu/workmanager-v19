# WorkManager v19 — Documento de Contexto Completo

> Usar este documento al inicio de cada sesión de desarrollo para dar contexto completo al asistente.
> Última actualización: 08/06/2026 (sesión 6 — TaskModal rediseño, WeekView, tiempo instancias, debug cleanup)

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
├── useTaskCRUD.ts               # Hook: handleAddTask, handleUpdateTask, handleDeleteTask, handleToggleStatus, handleAddRule
├── useTaskOrdering.ts           # Hook: handleUpdateTasksOrder, handleUpdateSubtasksOrder, handleGoToTemplate, expand/collapse, promote/demote
├── useBlockHandlers.ts          # Hook: CRUD de bloques de trabajo
├── useTimerHandlers.ts          # Hook: cronómetro, tiempo manual, adjuntos
├── useBulkActions.ts            # Hook: bulkUpdateTasks, bulkDeleteTasks, bulkDuplicateTasks
├── generation.worker.ts         # Web Worker: ejecuta generateInstances en hilo separado
├── useSupabaseData.ts           # Hook legacy (no usar)
├── TaskModal.tsx                # Modal de configuración de tarea — rediseñado sesión 6
├── StickyActionBar.tsx          # Barra de acciones sticky compartida entre vistas
├── DashboardView.tsx            # Vista principal del día
├── BlocksView.tsx               # Vista de gestión de bloques y tareas (templates)
├── CalendarView.tsx             # Vista de calendario mensual con carga por día
├── DelegadasView.tsx            # Vista de tareas delegadas por persona
├── SearchView.tsx               # Búsqueda global de tareas con filtros
├── WorkloadView.tsx             # Vista de carga de trabajo por bloques
├── WeekView.tsx                 # Vista semanal — NUEVA sesión 6
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
- `WeekView.tsx` es nuevo en sesión 6 — importado en App.tsx

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
  recurrence?: {
    frequency: 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly'
    weekDays?: number[]
    monthDay?: number
    yearDay?: number
    yearMonth?: number
    startDate: string
    endDate?: string | null
  }
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

**ViewType** (types.ts):
```typescript
export type ViewType = 'dashboard' | 'blocks' | 'calendar' | 'delegadas' | 'search' | 'workload' | 'week';
```

---

## 5. Arquitectura de Recurrencia — CRÍTICO

### Reglas CRÍTICAS
1. Los **contenedores** NUNCA tienen `recurrence`, `dueDate`, `dueTime`, `tags`, ni `delegation`
2. La **recurrencia va solo en las subtareas** (nivel 2)
3. Las **instancias normales NO se guardan** en Supabase — se regeneran en memoria
4. Solo se guardan si `isException: true` (modificadas individualmente)
5. `useGeneration` solo modifica instancias (`templateId` presente), **NUNCA** templates
6. **Recurrencia anual**: usa `yearDay` + `yearMonth`

### Cambio de fecha en instancia recurrente
- Desde Dashboard → abre modal preguntando "¿Solo este día o toda la serie?"
- "Solo este día" → llama `handleUpdateTask` con `instanceDate: task.instanceDate || task.dueDate` y `dueDate: newDate`
- Sin `instanceDate`, el cambio de fecha no activa el flujo de excepción (bug resuelto sesión 3)

---

## 6. Flujo de Carga al Iniciar (useSupabase.ts)

1. Carga `work_blocks`, `persons`, `time_entries`, `meetings`
2. Carga `tasks` con filtro: `template_id IS NULL OR is_exception = true`
3. Reconstruye jerarquía en 3 pasadas
4. Reparaciones automáticas
5. Limpieza de instancias borradas >30 días
6. `setIsDataLoaded(true)`

---

## 7. StickyActionBar — Arquitectura CRÍTICA

### Dónde vive
La `StickyActionBar` está montada en **App.tsx** directamente, entre el `<header>` y el `<div overflow-y-auto>`. NO está dentro de ninguna vista. Esto es intencional y necesario para que el sticky funcione correctamente.

```
<main flex-col>
  <header />                    ← fijo, shrink-0
  <StickyActionBar />           ← fijo aquí, FUERA del overflow-y-auto
  <div overflow-y-auto>         ← solo el contenido scrollea
    <AnimatePresence>
      <DashboardView />
      <BlocksView />
      ...
    </AnimatePresence>
  </div>
</main>
```

### Por qué funciona así
El scroll container es `<div className="flex-1 overflow-y-auto">` en App.tsx. El div raíz de la app es `h-screen overflow-hidden` — esto es crítico, sin esto el scroll ocurre en el body y el sticky no funciona.

### Estado de vista en App.tsx (lifted state)
Los estados que controla la StickyActionBar para cada vista están en App.tsx:
- `dashHideCompleted` / `setDashHideCompleted`
- `dashExpandAll` / `setDashExpandAll`
- `dashExpandedBlocks` / `setDashExpandedBlocks`
- `delegadasHideCompleted` / `setDelegadasHideCompleted`
- `blocksExpanded` / `setBlocksExpanded`
- `blocksToggleExpandRef` — ref para callback de expand en BlocksView

### Props de StickyActionBar
```typescript
StickyActionBar {
  selectionMode: boolean
  selectedCount: number
  onToggleSelectionMode: () => void
  onAddTask?: () => void
  hideCompleted?: boolean
  onToggleHideCompleted?: () => void
  expandAll?: boolean | null          // Dashboard subtareas
  onToggleExpandAll?: () => void
  expandedBlocksCount?: number        // Dashboard grupos tag
  expandedBlocksTotal?: number
  onToggleExpandBlocks?: () => void
  expanded?: boolean                  // BlocksView genérico
  onToggleExpand?: () => void
  onDelegate?: () => void
  onChangeDate?: () => void
  onComplete?: () => void
  onChangeTime?: () => void
  onDuplicate?: () => void
  onDelete?: () => void
}
```

### Vistas que NO muestran buscador en header
- **Búsqueda** (`search`)
- **Calendario** (`calendar`)
- **Carga** (`workload`)
- **Semana** (`week`)

---

## 8. BlocksView — Header de bloque

El header del bloque seleccionado (nombre + icono + nº tareas + toggle ocultar completadas) es **sticky top-0** dentro del scroll container. Al seleccionar un bloque o volver atrás, se hace scroll automático al top:
```js
const scrollEl = document.querySelector('.overflow-y-auto');
if (scrollEl) scrollEl.scrollTop = 0;
```

---

## 9. Sistema de Colores

### Color principal
`turquesa: #14B8A6` — color oficial del logo WorkManager. Usado en toda la app para acciones primarias, chips activos, highlights, botones.

**Para volver al cyan original**: cambiar `#14B8A6` → `#06B6D4` en `tailwind.config.js` (una línea).

### Paleta completa (tailwind.config.js)
```js
'turquesa': '#14B8A6',   // color oficial logo — antes #06B6D4
'esmeralda': '#14B8A6',  // alias de turquesa
'azul': '#3B82F6',
'morado': '#8B5CF6',
'rosa': '#EC4899',
'verde': '#10B981',
'lima': '#84CC16',
'naranja': '#F97316',
```

### Acento estructural (index.css)
Borde esmeralda en lateral y barra:
- `nav`: `border-right: 2px solid rgba(20,184,166,0.3)` light / `rgba(20,184,166,0.2)` dark
- `.sticky-action-bar-border`: `border-bottom: 2px solid rgba(20,184,166,0.3)` light / `rgba(20,184,166,0.2)` dark
- Scrollbar: 6px, thumb con esmeralda al 25% en light

### Colores semánticos en código
- Contenedores estructurales: `dark:bg-bg-secondary bg-bg-secondary-light`
- Cards: `dark:bg-bg-card bg-bg-card-light`
- Bordes: `dark:border-border-main border-border-main-light`
- Colores inline (hex directo): para colores dinámicos o condicionales que Tailwind no puede generar

### Colores de tiempo registrado
- **Lima** `#84CC16`: registrado < estimado
- **Naranja** `#F97316`: registrado ≥ 90% del estimado
- **Rosa** `#EC4899`: registrado > estimado
- **Slate**: sin registrar (0)

### Colores de carga (WorkloadView y WeekView)
- Verde `#10B981`: < 60%
- Naranja `#F59E0B`: 60–80%
- Morado `#A855F7`: 80–100%
- Rosa `#EC4899`: > 100%

---

## 10. Selección de Tareas — UX

- **Toda la card es clickable** en modo selección (no solo el checkbox)
- Click en zona libre de la card → selecciona/deselecciona
- Click en botones/inputs → comportamiento normal (stopPropagation)
- **Checkbox** se transforma visualmente: borde azul (no seleccionado) → relleno azul (seleccionado)
- **Ring azul** alrededor de la card seleccionada
- Fondo azul sutil en cards seleccionadas
- Selección en **cascada**: seleccionar contenedor selecciona todas sus subtareas

---

## 11. Vistas — Estado Actual

### DashboardView.tsx
- StickyActionBar en App.tsx recibe estados lifted: hideCompleted, expandAll, expandedBlocks
- Header de fecha con 3 columnas simétricas (grid-cols-3): nav izquierda, fecha centrada, vacío derecha
- `pendingDateChange` modal para cambio de fecha en instancias recurrentes

### BlocksView.tsx
- Header del bloque seleccionado: sticky top-0 dentro del scroll container
- Al seleccionar bloque o volver: scroll automático al top via `document.querySelector('.overflow-y-auto').scrollTop = 0`
- `expandedIds` (estado local): todos colapsados por defecto
- Búsqueda por `searchQuery` filtra `coreTasks`/`adhocTasks`; auto-expande contenedores con coincidencias

### DelegadasView.tsx
- Botón "Reunión" compacto (sin "Nueva") en el header
- `hideCompletedExternal` prop sincroniza con estado lifted en App.tsx
- Filtro: solo `isTemplate:true` o `!templateId`

### SearchView.tsx
- `onGoToTemplate` prop conectado — muestra flechita ↗ en tareas recurrentes igual que Dashboard
- Botón "BLOQUES →" en header de cada grupo navega a vista Bloques (onNavigateToBlocks)
- Buscador propio interno (el del header global no aplica aquí — está oculto)

### CalendarView.tsx
- StickyActionBar muestra solo Seleccionar (sin + Tarea, sin ocultar completadas)
- Buscador del header oculto en esta vista

### WorkloadView.tsx
- Header sticky: `th` de meses y semanas tienen fondo opaco `dark:bg-bg-card bg-white` para tapar contenido al scrollear
- Buscador del header oculto en esta vista

### WeekView.tsx — NUEVA sesión 6
- Vista semanal entre Dashboard y Bloques en el nav (icono `CalendarDays`)
- Toggle L-V / L-D para mostrar fin de semana
- Navegación `< Hoy >` + input de fecha para saltar
- Toggle **Carga** (morado): muestra desglose Core (turquesa) / Adhoc (rosa) por bloque con barra proporcional
- Header de cada día: día/fecha + tiempo (pasado → registrado con 🕐, futuro → estimado)
- Barra de carga coloreada por % capacidad (mismos colores que WorkloadView)
- Bloques colapsables por día — clic expande cards compactas (WeekTaskCard)
- Tiempo correcto: `getTaskMins` suma subtareas hoja recursivamente
- Ventana ±60 días: dentro usa `filterTasksForDay` + instancias Worker; fuera genera instancias virtuales desde templates (`generateVirtualInstances`)
- Clic en header de día → navega al Dashboard de ese día
- `+ Añadir` al fondo de cada columna

---

## 12. TaskModal — Rediseño Sesión 6

### Estructura
- **Sin footer** — botones en el header
- **Header**: `[←padre] título | [✓][🗑][💾][X]`
- **Fila 1**: tipo Core/Adhoc + bloque (select) + estimado (input min) + registrado (✓ Xm clicable)
- **Fila 2**: grid `[tags][delegación][fecha]` — altura uniforme, separadores border-x
- **Fila 3**: hora — solo aparece cuando hay fecha y no es recurrente
- **Recurrencia**: colapsada por defecto, badge muestra patrón activo (ej. "L-V")
- **Subtareas**: lista compacta con chips inline
- **Notas**: textarea autosize (2 filas mínimo, crece sola)
- **Adjuntos**: thumbnails 32px

### Tiempo registrado en TaskModal
- El chip `✓ Xm` en fila 1 usa `useMemo` con `getTaskRegisteredCombo(localTask.id, ...)`
- Al clicar abre `TimeManagementPanel` con `fromModal=true` (se centra en pantalla, bordes redondeados)
- `taskId={localTask.id}` — siempre el ID de la instancia, nunca el templateId
- Props necesarios: `timeEntries`, `onAddTimeEntry`, `onDeleteTimeEntry`, `onUpdateTimeEntry`

### DelegationChip
- Color cambiado de **morado** a **azul** en sesión 6

---

## 13. TimeManagementPanel — Rediseño Sesión 6

### Estructura
- Panel flotante: desde TaskCard → bottom sheet; desde TaskModal (`fromModal=true`) → centrado
- **Header compacto**: título + barra de progreso + `Xm / Ym` en una línea
- **Solo tab Historial** — el formulario de registro siempre visible, sin tab "Registro"
- **Orden**: `[Registrar][Cerrar]` arriba → minutos/fecha → nota → checkbox completar
- **Historial**: lista compacta, una línea por entrada, edición inline

### onOpenTimePanel
- En App.tsx, `onOpenTimePanel` en TaskCard ahora llama `setEditingTaskId(subtaskId || taskId)` — abre el **TaskModal** directamente en vez del panel inline
- Hay una sola pantalla de gestión de tiempo — el TaskModal
- El `TimeManagementPanel` standalone sigue disponible para el cronómetro (TimerStopModal)

---

## 14. Tiempo Registrado — Arquitectura CRÍTICA sesión 6

### Cómo se guarda
- `handleManualTimeEntry` guarda `taskId` tal cual — sin `resolveIdForDB`
- `task_id` en Supabase puede ser `inst-t-xxx-fecha` (instancias) o `t-xxx` (tareas normales)
- **No hay FK activa** en `time_entries.task_id` — confirmado con SELECT en Supabase

### Cómo se carga
- `useSupabase.ts` mapea `e.task_id → taskId` directamente, sin conversión
- Las entradas de instancias vienen con `task_id = inst-t-xxx-fecha` ya correcto

### Cómo se calcula
- `getTaskRegisteredCombo(localTask.id, ...)` busca por el instanceId directamente
- Para el panel inline: `TimeManagementPanel` filtra `e.taskId === taskId`
- Para el chip en fila 1 del TaskModal: `useMemo` sobre `timeEntries` filtrados por `localTask.id`

---

## 15. Bugs Resueltos — Sesión 6 (08/06/2026)

| # | Descripción | Archivos |
|---|-------------|---------|
| 4 | Highlight búsqueda: borde turquesa fijo (no amarillo) mientras searchQuery activo | `TaskCard.tsx` |
| 6 | Logs debug eliminados: PICKING, BOTÓN ROSA, CHIP DEBUG, CHIP RENDER, MOVE, STATS DEBUG, PENDING LEAF, PENDING SUB | `TaskCard.tsx`, `DashboardView.tsx` |
| 11 | WorkloadView buscador: oculto header en search/calendar/workload/week | `App.tsx` |
| — | WorkloadView sticky header: fondos opacos en th meses y semanas | `WorkloadView.tsx` |
| — | TaskModal rediseñado completo (ver sección 12) | `TaskModal.tsx`, `App.tsx` |
| — | DelegationChip color morado → azul | `Chips.tsx` |
| — | TimeManagementPanel rediseñado (ver sección 13) | `TimeComponents.tsx` |
| — | Tiempo manual instancias: eliminado resolveIdForDB, guardar taskId tal cual | `useTimerHandlers.ts` |
| — | onOpenTimePanel → abre TaskModal en vez de panel inline | `App.tsx` |
| — | WeekView creada (ver sección 11) | `WeekView.tsx`, `App.tsx`, `types.ts` |

---

## 16. Bugs / Mejoras Pendientes

| # | Descripción | Archivo | Notas |
|---|-------------|---------|-------|
| 7 | Limpiar instancias Picking en Supabase | Supabase SQL | Verificar con SELECT primero |
| B1 | Bug: completado no persiste tras recarga | `useTaskCRUD.ts` / `useSupabase.ts` | Identificado, no resuelto |
| W1 | WeekView: pulir detalles visuales | `WeekView.tsx` | Ver notas próxima sesión |
| HR | DPTs y Guía Operativa payroll | Docs HR | Pendiente redactar |

---

## 17. Reglas de Negocio

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

---

## 18. Workflow de Desarrollo

```
1. Abrir CMD como administrador (no PowerShell)
2. cd "C:\Users\Israe\OneDrive\Escritorio\workmanager-v19"
3. npm run dev → http://localhost:3001
4. GitHub Desktop: commit → push origin master → Vercel despliega
```

---

## 19. Notas para el Asistente

- **Siempre pedir el archivo antes de modificarlo**
- **Verificar en Supabase con SQL** antes de asumir que es problema de código
- **La tabla tasks NO tiene columna `subtasks`** — es array reconstruido en memoria
- El TaskModal está en `TaskModal.tsx`
- `generation.worker.ts` es archivo separado en src/ (no import normal)
- `useSupabaseData.ts` es legacy — no tocar
- El Worker recibe copia serializada de `tasks` — no accede al estado React
- **Un bug a la vez**
- Preferencia: archivos completos de reemplazo, no edits parciales
- El div raíz de App.tsx DEBE ser `h-screen overflow-hidden` — no cambiar a `min-h-screen`
- La StickyActionBar DEBE estar en App.tsx fuera del scroll container — no moverla a las vistas
- Color turquesa oficial: `#14B8A6` (mismo que logo SVG en App.tsx)
- **`time_entries` en JS son camelCase**: `taskId`, `subtaskId`, `duration`, `createdAt`
- **`time_entries` NO tiene FK activa** — guardar taskId tal cual, incluyendo `inst-t-xxx-fecha`
- **`filterTasksForDay` firma completa**: `(tasks, allTasksMap, activeBlockIds: Set<string>, activeDate, options)`
- **WeekView**: usa `filterTasksForDay` para fechas dentro de ventana ±60 días; `generateVirtualInstances` para fuera

---

## 20. Ideas Pendientes

1. **Barra ghost** — StickyActionBar que aparece solo al scrollear (scroll listener en overflow-y-auto)
2. **Completado con descarte** — `wasDiscarded:true`, X en vez de tick. Requiere columna en Supabase
3. **Tag "bloqueada"** — Tarea oculta hasta activarse manualmente
4. **WorkManager Assistant** — Agente Relevance AI integrado via Vercel serverless (construido, no funcional)
5. **Migración esmeralda completa** — actualmente `turquesa` y `esmeralda` son el mismo valor `#14B8A6`
6. **WeekView mejoras**: ocultar completadas toggle, reordenar días con drag, mover tarea entre días
