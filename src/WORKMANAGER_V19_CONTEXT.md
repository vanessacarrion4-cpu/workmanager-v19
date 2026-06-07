# WorkManager v19 — Documento de Contexto Completo

> Usar este documento al inicio de cada sesión de desarrollo para dar contexto completo al asistente.
> Última actualización: 07/06/2026 (sesión 3 — refactor completo + UX mejoras)

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
├── App.tsx                      # ~500 líneas. Estado global, hooks, routing entre vistas
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
├── TaskModal.tsx                # Modal de configuración de tarea (extraído de App.tsx)
├── StickyActionBar.tsx          # Barra de acciones sticky compartida entre vistas
├── DashboardView.tsx            # Vista principal del día
├── BlocksView.tsx               # Vista de gestión de bloques y tareas (templates)
├── CalendarView.tsx             # Vista de calendario mensual con carga por día
├── DelegadasView.tsx            # Vista de tareas delegadas por persona
├── SearchView.tsx               # Búsqueda global de tareas con filtros
├── WorkloadView.tsx             # Vista de carga de trabajo por bloques
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

## 7. StickyActionBar — Componente Compartido

Barra sticky en todas las vistas (Dashboard, Bloques, Delegadas, Calendario).

**Estado normal — 3 zonas:**
```
[Seleccionar] | [👁 Ocultar completadas] [⊞ Expandir/Contraer] | [+ Tarea]
```

**Estado selección activa:**
```
[2 ✓] | [Delegar] [Fecha] [Completar] [Tiempo] [Duplicar] [Eliminar] | [✕]
```

**Props:**
```typescript
StickyActionBar {
  selectionMode: boolean
  selectedCount: number
  onToggleSelectionMode: () => void
  onAddTask?: () => void
  hideCompleted?: boolean
  onToggleHideCompleted?: () => void
  expanded?: boolean
  onToggleExpand?: () => void
  onDelegate?: () => void
  onChangeDate?: () => void
  onComplete?: () => void
  onChangeTime?: () => void
  onDuplicate?: () => void
  onDelete?: () => void
}
```

**PENDIENTE**: El botón `+ Tarea` debe estar SOLO en StickyActionBar (siempre visible al scrollear). Quitar duplicados del header de cada vista. En DashboardView aún quedan botones de expandir subtareas, expandir grupos (Tag) y ocultar completadas en el header de fecha — moverlos o limpiarlos.

---

## 8. Selección de Tareas — UX Mejorada

- **Toda la card es clickable** en modo selección (no solo el checkbox)
- Click en zona libre de la card → selecciona/deselecciona
- Click en botones/inputs → comportamiento normal (stopPropagation)
- **Checkbox** se transforma visualmente: borde azul (no seleccionado) → relleno azul (seleccionado)
- **Ring azul** alrededor de la card seleccionada
- Fondo azul sutil en cards seleccionadas

---

## 9. Vistas — Estado Actual

### BlocksView.tsx
- Header compacto sticky con nombre del bloque + StickyActionBar integrada
- `expandedIds` (estado local): todos colapsados por defecto (`forceExpanded={false}`)
- `forceExpanded` se propaga a subtareas hijas también
- Búsqueda por `searchQuery` filtra `coreTasks` y `adhocTasks`; auto-expande contenedores con coincidencias en subtareas

### DashboardView.tsx
- StickyActionBar arriba con seleccionar + ocultar completadas + añadir
- Header de fecha con expandir subtareas, expandir grupos (Tag) — **pendiente limpiar duplicados**
- `pendingDateChange` modal para cambio de fecha en instancias recurrentes (restaurado en sesión 3)

### DelegadasView.tsx
- StickyActionBar integrada
- Filtro: solo `isTemplate:true` o `!templateId`

### CalendarView.tsx
- Import de StickyActionBar preparado, sin selección implementada aún

---

## 10. Bugs Resueltos — Sesión 3 (07/06/2026)

31. Modal `pendingDateChange` se había perdido en refactor → restaurado en App.tsx
32. `instanceDate` faltaba al confirmar cambio de fecha → corregido
33. Imports faltantes en `Chips.tsx` (`ChevronDown`, `Plus`, `CalendarIcon`, `MonthDatePicker`) → corregidos
34. Imports faltantes en `Modals.tsx` (`Circle`, `CheckCircle2`, `LayoutDashboard`) → corregidos
35. Contenedores no colapsaban por defecto en BlocksView → `forceExpanded={false}` en vez de `undefined`
36. `forceExpanded` no se propagaba a subtareas hijas → corregido en TaskCard recursivo
37. Buscador en BlocksView no filtraba → `coreTasks`/`adhocTasks` ahora filtran por `searchQuery`
38. Auto-expand de contenedores con coincidencias en subtareas al buscar

---

## 11. Bugs / Mejoras Pendientes

| # | Descripción | Prioridad |
|---|-------------|-----------|
| 1 | DashboardView — botones de expandir subtareas, expandir grupos y ocultar completadas duplicados en header de fecha. Limpiar y dejar solo en StickyActionBar | Alta |
| 2 | StickyActionBar — quitar `+ Tarea` del header de cada vista, dejar solo en StickyActionBar | Alta |
| 3 | Templates recurrentes en Bloques — tiempo estimado y registrado se suma incorrectamente en la plantilla. Verificar lógica | Media |
| 4 | Tareas pasadas en Dashboard — mostrar tiempo estimado y tiempo registrado | Media |
| 5 | Highlight en SearchView — borde turquesa + scroll en vez del fondo amarillo actual | Media |
| 6 | Nivel 3 sin indentación visual — sub-subtareas visualmente iguales a nivel 2 | Baja |
| 7 | Logs debug pendientes de limpiar: `[PICKING DEBUG]`, `[CHIP DEBUG]`, `[CHIP RENDER]`, `[STATS DEBUG]` | Baja |
| 8 | Instancias Picking en Supabase — limpiar con SQL: `DELETE FROM tasks WHERE id LIKE 'inst-t-%' AND parent_task_id IS NOT NULL` | Baja |
| 9 | Completar contenedor cuando todas las hijas están completadas — botón ya existe, verificar que funciona | Baja |

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
- El TaskModal está en `TaskModal.tsx`
- `generation.worker.ts` es archivo separado en src/ (no import normal)
- `useSupabaseData.ts` es legacy — no tocar
- El Worker recibe copia serializada de `tasks` — no accede al estado React
- **Un bug a la vez**
- Preferencia: archivos completos de reemplazo, no edits parciales

---

## 15. Ideas Pendientes

1. **Completado con descarte** — `wasDiscarded:true`, X en vez de tick. Requiere columna en Supabase.
2. **Tag "bloqueada"** — Tarea oculta hasta activarse manualmente.
3. **WorkManager Assistant** — Agente Relevance AI integrado via Vercel serverless (construido, no funcional).
