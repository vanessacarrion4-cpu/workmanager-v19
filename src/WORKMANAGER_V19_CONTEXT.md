# WorkManager v19 — Documento de Contexto Completo

> Usar este documento al inicio de cada sesión de desarrollo para dar contexto completo al asistente.
> Última actualización: 26/05/2026

---

## 1. Stack y Repositorio

- **Framework**: React + TypeScript + Vite + Tailwind CSS
- **Base de datos**: Supabase (PostgreSQL via PostgREST)
- **Repo**: `vanessacarrion4-cpu/workmanager-v19` (GitHub)
- **Deploy**: Vercel CI/CD automático desde rama `master`
- **URL producción**: `workmanager-v19.vercel.app`
- **Supabase URL**: `yewfmfoljidvrxvbrsdv.supabase.co`

---

## 2. Estructura de Archivos (`src/`)

```
src/
├── App.tsx                    # Componente raíz. Estado global, handlers, routing entre vistas
├── types.ts                   # Interfaces TypeScript: Task, WorkBlock, TimeEntry, Person, etc.
├── constants.ts               # INITIAL_BLOCKS, COLORS, TAG_LABELS
├── supabaseClient.ts          # Inicialización cliente Supabase
├── dateUtils.ts               # formatLocalISO(), parseLocalISO()
├── utils.ts                   # generateInstances(), isTaskCompleted(), projectLoad(), etc.
├── filters.ts                 # filterTasksForDay(), groupTasksByTag(), getStatsForDay()
├── useSupabase.ts             # Hook: carga inicial desde Supabase + reparaciones
├── useGeneration.ts           # Hook: genera instancias recurrentes via Web Worker
├── generation.worker.ts       # Web Worker: ejecuta generateInstances en hilo separado
├── useSupabaseData.ts         # Hook legacy (no usado activamente)
├── DashboardView.tsx          # Vista principal del día
├── BlocksView.tsx             # Vista de gestión de bloques y tareas
├── CalendarView.tsx           # Vista de calendario mensual
├── DelegadasView.tsx          # Vista de tareas delegadas por persona
├── SearchView.tsx             # Búsqueda global de tareas
├── WorkloadView.tsx           # Vista de carga de trabajo por bloques
├── components.tsx             # Todos los componentes reutilizables
├── main.tsx                   # Entry point React
└── index.css                  # Tailwind + scrollbar custom
```

---

## 3. Arquitectura de Datos

### Tablas Supabase
- `work_blocks` — Bloques de trabajo (9 bloques)
- `tasks` — Todas las tareas: templates, manuales, instancias excepción
- `persons` — Personas para delegación
- `time_entries` — Registros de tiempo
- `meetings` — Reuniones de delegación

### Modelo de Tareas (arquitectura clave)

```
Task {
  id: string                  // "t-{timestamp}" o "inst-{templateId}-{date}"
  blockId: string             // A qué bloque pertenece
  title: string
  status: 'pending' | 'completed'
  dueDate: string | null      // YYYY-MM-DD. NUNCA en contenedores.
  tags: TagType[]             // 'con_hora' | 'focus' | 'dirección' | 'espera' | 'resto'
  
  // Jerarquía
  parentTaskId?: string       // ID del padre (si es subtarea)
  subtasks?: string[]         // IDs de hijos directos
  
  // Recurrencia
  isTemplate?: boolean        // true = plantilla maestra, no se muestra en Dashboard
  templateId?: string         // ID del template del que viene esta instancia
  instanceDate?: string       // Fecha a la que pertenece esta instancia
  isException?: boolean       // true = instancia modificada individualmente, guardada en Supabase
  recurrence?: {...}          // Configuración de recurrencia (SOLO en subtareas, NUNCA en contenedores)
  
  // Otros
  isDeleted?: boolean         // Soft delete
  isActive?: boolean          // Si el template genera instancias
  existsInSupabase?: boolean  // Marcador en memoria para proteger instancias
  estimatedMinutes: number
  delegation?: { personId, delegatedAt }
  attachments?: Attachment[]
  order: number
  wasRecurring?: boolean      // Marca informativa
}
```

### Flujo de Recurrencia

```
Contenedor template (isTemplate:true, dueDate:null, recurrence:null — en Supabase)
  └── Subtarea template (isTemplate:true, recurrence:{...}, dueDate:null — en Supabase)

→ useGeneration (via Web Worker) genera en memoria:

inst-{templateId}-{fecha} (isTemplate:false, solo en memoria o excepción en Supabase)
  └── inst-{subTemplateId}-{fecha} (isTemplate:false, solo en memoria)
```

**REGLAS CRÍTICAS de recurrencia:**
- Los contenedores **NUNCA** tienen `recurrence` ni `dueDate` propios
- La recurrencia va **solo en las subtareas**
- Las instancias normales **NO se guardan** en Supabase
- Solo se guardan si el usuario las modifica individualmente (`isException: true`)
- `useGeneration` solo modifica instancias (`templateId` presente), **NUNCA** templates

### Carga desde Supabase (con paginación)

```typescript
// Solo carga templates/manuales + excepciones:
.or('template_id.is.null,is_exception.eq.true')
.range(from, from + PAGE_SIZE - 1)  // Paginación para superar límite 1000 de PostgREST
```

---

## 4. Web Worker de Generación (`generation.worker.ts`)

**Introducido en sesión 26/05/2026** para resolver bloqueos de UI al añadir recurrencia.

- `generateInstances()` se ejecuta en un hilo separado
- El hilo principal nunca se bloquea → los saves de Supabase siempre terminan
- `DAYS_PAST = 30`, `DAYS_FUTURE = 60` (reducido de 365 a 60 para limitar volumen)
- El Worker se termina y recrea en cada cambio de `templateKey`
- Early return si no hay instancias nuevas ni merges pendientes

**Volumen esperado con recurrentes completas:**
- ~10 diarias + ~10 semanales + ~300 mensuales + ~300 anuales
- Con 60 días: ~700-2400 instancias (manejable sin bloqueo)
- Con 365 días: ~30.000+ instancias (inaceptable sin Worker)

---

## 5. Hooks Principales

### `useSupabase.ts`
Carga inicial al montar la app:
1. Carga bloques, tareas (paginadas), personas, time_entries, meetings
2. Reconstruye jerarquía en 3 pasadas: `reconstructHierarchy`, `reconstructInstanceHierarchy`, `reconstructExceptionContainerSubtasks`
3. Reparaciones automáticas: `repairContainersWithForbiddenData` (solo templates), `repairRecurringContainers`
4. Limpieza automática: borra instancias `is_deleted:true` de más de 30 días

### `useGeneration.ts`
Usa Web Worker. Se ejecuta cuando cambia `templateKey`:
1. Limpia instancias en memoria fuera de ventana ±30/60 días
2. Envía datos al Worker → Worker ejecuta `generateInstances()`
3. Recibe instancias → merge con existentes de Supabase (PASO 2)
4. Vincula subtareas a sus contenedores (PASO 3)
5. Early return si `newInstances.length === 0 && !needsMerge`

---

## 6. Filtrado y Agrupación (`filters.ts`)

### `filterTasksForDay(tasks, allTasksMap, activeBlockIds, activeDate, options)`
- ❌ Borradas, templates, subtareas solas, bloques inactivos
- ❌ Delegadas sin tag real (si `hideDelegatedNoTag:true`)
- ✅ Tarea con `dueDate === activeDate`
- ✅ Contenedor **sin dueDate** con ≥1 subtarea pendiente ese día
- **IMPORTANTE**: Un contenedor con `dueDate` propio entra por la rama de fecha, no por la de contenedor. Los contenedores **nunca deben tener fecha**.

### `getVisibleSubtasksForDay(container, allTasksMap, activeDate, options)`
Dos caminos de búsqueda:
- **CASO 1** (recurrentes): `task.templateId` → `subtaskTemplate.parentTaskId === containerTemplateId`
- **CASO 2** (manuales): `task.parentTaskId === container.id || task.parentTaskId === containerTemplateId`

**FIXES aplicados:**
- `if (task.isTemplate) return false` — templates nunca aparecen como subtareas visibles
- Si contenedor es instancia (`container.templateId`), excluir subtareas manuales que apuntan al template pero no son instancias (`!task.templateId`)
- `hideDelegatedNoTag: true` en `getStatsForDay` para consistencia con el Dashboard

### `getStatsForDay(dayTasks, allTasksMap, timeEntries, activeDate)`
- Solo cuenta tareas hoja (`!subtasks || subtasks.length === 0`)
- Usa `getVisibleSubtasksForDay` con `hideDelegatedNoTag: true`
- Deduplicación con `seenIds Set`
- Tareas simples solo cuentan si `dueDate === activeDate`

---

## 7. Vistas

### Dashboard (`DashboardView.tsx`)
- Vista principal del día con navegación por fechas
- Tareas agrupadas por tag: Con Hora, Focus, Dirección, En Espera, Resto
- Stats: tareas completadas, tiempo estimado pendiente, tiempo registrado
- Drag & drop con `Reorder` de framer-motion (persiste a Supabase)

### Bloques (`BlocksView.tsx`)
- Gestión de tareas por bloque (aquí se crean templates con subtareas recurrentes)
- Vista de árbol con drag & drop para reordenar

### Calendario (`CalendarView.tsx`)
- Vista mensual con indicadores de carga por día y resumen semanal
- Color coding: esmeralda/naranja/morado/rosa por umbrales de minutos

### Delegadas (`DelegadasView.tsx`)
- Accordion por persona con tareas asignadas
- Sistema de reuniones con notas formateadas
- Flechitas ▲▼ para reordenar (persiste a Supabase)

### Búsqueda (`SearchView.tsx`) y Carga de Trabajo (`WorkloadView.tsx`)
- WorkloadView usa `projectLoad()` de utils.ts (genera instancias localmente sin tocar estado global)

---

## 8. Guardado de Datos en Supabase

### Time entries con instancias recurrentes
```typescript
// Las instancias en memoria tienen IDs tipo "inst-t-xxx-2026-05-26"
// Estos IDs NO existen en Supabase → error FK
// Fix: resolver el templateId antes de guardar
const resolveIdForDB = (id: string) => {
  if (!id.startsWith('inst-')) return id;
  const task = tasks[id];
  return task?.templateId || id;
};
```

### Guardar tarea con recurrencia
```typescript
// Cuando updatedTask tiene recurrencia → guardar con:
due_date: updatedTask.recurrence ? null : (updatedTask.dueDate || null),
is_template: isInstance ? false : (updatedTask.recurrence ? true : (updatedTask.isTemplate || false)),
```

### Reordenar tareas
```typescript
// handleUpdateTasksOrder — persiste order en Supabase
// handleUpdateSubtasksOrder — persiste order de subtareas en Supabase
```

---

## 9. Componentes Clave (`components.tsx`)

- `TaskCard` — Tarjeta con chips. Variantes COMPACT/FULL. Icono 📎 si hay adjuntos.
- `TimeManagementPanel` — Panel registro de tiempo. Compactado en sesión 26/05.
- `RegisteredTimeChip` — Chip de tiempo registrado. **Colores con estilos inline** (no Tailwind dinámico): turquesa (ok), naranja (≥90% estimado), rosa (excedido), gris (0m).
- `RecurrencePickerChip` — Selector de recurrencia con **estado local** (`localValue`) para no disparar `useGeneration` en cada clic. `onChange` solo se llama al cerrar el popup.
- `TimerStopModal` — Modal al parar cronómetro (reemplaza `prompt()` nativo).
- `BlockModal` — Modal de creación/edición de bloques.
- `RecurrenceChoiceModal` — "¿Editar solo esta instancia o todas?"
- `TaskModal` — En **App.tsx** (no en components.tsx). Compactado en sesión 26/05.

---

## 10. Bugs Conocidos y Fixes

### ✅ Resueltos (sesiones anteriores)
1. PostgREST límite 1000 filas → paginación
2. Time entries FK error con instancias → `resolveIdForDB()`
3. `repairContainersWithForbiddenData` borraba datos normales → guard `isTemplate`
4. Tareas duplicadas por instancias excepción con `due_date=null` → UPDATE Supabase
5. Notas no persistían → `useEffect([task.id])` en TaskModal
6. Timer stop usaba `prompt()` → `TimerStopModal`
7. Drag & drop en Dashboard, Bloques y Delegadas
8. Adjuntos no persistían → fix en upsert y mapeo useSupabase

### ✅ Resueltos en sesión 26/05/2026
9. **Bloqueo UI al añadir recurrencia** → Web Worker + `DAYS_FUTURE: 60`
10. **Subtareas duplicadas** (template + instancia en mismo día) → `if (task.isTemplate) return false` en `getVisibleSubtasksForDay`
11. **Subtarea manual duplicada en contenedor con instancia** → Excluir subtareas manuales que apuntan al template cuando el contenedor es instancia
12. **`handleClose` not defined** en TagPickerChip, EstimatedTimeChip, BlockPickerChip → `onClick={() => setShow(false)}`
13. **Stats contaban subtareas delegadas sin tag** → `hideDelegatedNoTag: true` en `getStatsForDay`
14. **`RegisteredTimeChip` invisible en light mode** → Estilos inline con hex
15. **Modales demasiado grandes** → TaskModal y TimeManagementPanel compactados (~30%)
16. **Contenedor con `dueDate` propio no aparecía en Dashboard** → Quitar fecha del contenedor. Los contenedores nunca deben tener fecha.

### ⚠️ Pendientes
1. **Modal bloqueado al modificar desde línea reducida** — Se congela en algún caso edge. Pendiente de reproducir y diagnosticar.
2. **`handleAddTask` asigna `dueDate` a contenedores nuevos** — Al crear un contenedor desde el Dashboard en un día concreto, hereda la fecha del día activo. Fix: los contenedores deben crearse siempre con `dueDate: null`.

---

## 11. Reglas de Negocio

1. **Templates nunca aparecen en Dashboard** — `isTemplate:true` los bloquea en `filterTasksForDay`
2. **Subtareas nunca aparecen solas** — Solo bajo su contenedor padre
3. **Los contenedores NUNCA tienen `dueDate` propio** — Solo sus subtareas tienen fecha
4. **Los contenedores NUNCA tienen `recurrence`** — La recurrencia va en las subtareas
5. **Delegadas sin tag real se ocultan** del Dashboard y stats (`hideDelegatedNoTag`)
4. **Contenedor desaparece cuando todas sus subtareas del día están completadas**
5. **Instancias no se guardan en Supabase** — Solo las excepciones
6. **`order` persiste en Supabase** via `handleUpdateTasksOrder` / `handleUpdateSubtasksOrder`
7. **Zona horaria**: Barcelona UTC+2 (verano). Timestamps Supabase en UTC.
8. **Colores condicionales**: siempre con inline styles hex, nunca Tailwind dinámico

---

## 12. Bloques de Trabajo

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

## 13. Tags

| Tag | Label | Descripción |
|-----|-------|-------------|
| `con_hora` | Con Hora | Tareas con hora fija |
| `focus` | Focus | Tareas prioritarias de concentración |
| `dirección` | Dirección | Decisiones estratégicas |
| `espera` | En Espera | Seguimiento activo esperando respuesta externa |
| `resto` | Resto | Sin clasificar |

---

## 14. Convenciones de IDs

- Tareas manuales/templates: `t-{Date.now()}` ej: `t-1778617274921`
- Instancias: `inst-{templateId}-{YYYY-MM-DD}` ej: `inst-t-1778445069239-2026-05-26`
- Time entries: `te-{Date.now()}`
- Adjuntos: `att-{Date.now()}`
- Bloques: `b{n}` iniciales, `b-{timestamp}` nuevos

---

## 15. Supabase Storage — Adjuntos

- **Bucket**: `task-attachments` (público)
- **Columna**: `attachments JSONB DEFAULT '[]'` en tabla tasks
- **Path**: `{taskId}/{timestamp}.{ext}`
- Las imágenes se muestran como miniatura en el modal

---

## 16. Variables de Entorno (Vercel)

```
VITE_SUPABASE_URL=https://yewfmfoljidvrxvbrsdv.supabase.co
VITE_SUPABASE_ANON_KEY={clave anon de Supabase}
```

---

## 17. Estado Actual de Archivos (26/05/2026)

| Archivo | Última modificación | Cambios principales |
|---------|--------------------|--------------------|
| App.tsx | 26/05/2026 | TaskModal compactado, fix dueDate en recurrencia, fix parentTaskId |
| useGeneration.ts | 26/05/2026 | Web Worker, DAYS_FUTURE:60, early return |
| generation.worker.ts | 26/05/2026 | **NUEVO** — generateInstances en Web Worker |
| filters.ts | 26/05/2026 | Fix templates en getVisibleSubtasksForDay, fix subtareas manuales en instancias, hideDelegatedNoTag en getStatsForDay |
| components.tsx | 26/05/2026 | RecurrencePickerChip con localValue, fix handleClose, RegisteredTimeChip inline styles, TimeManagementPanel compactado |
| useSupabase.ts | 14/05/2026 | Fix attachments, fix repairContainers isTemplate guard |
| DashboardView.tsx | 14/05/2026 | Drag & drop, logs debug (pendiente limpiar) |
| BlocksView.tsx | 14/05/2026 | Reorder.Item |
| DelegadasView.tsx | 14/05/2026 | Flechitas ▲▼, persistencia Supabase |
| utils.ts | 11/05/2026 | Fix subtareas manuales en contenedores recurrentes |
| CalendarView.tsx | 09/05/2026 | Color coding, load indicators |
| WorkloadView.tsx | 10/05/2026 | Rediseño Opción A |

---

## 18. Ideas Pendientes (no implementadas)

1. **Completado con descarte** — Tercer estado visual del check (`wasDiscarded: true`). Cuenta como completada en stats. Visualmente diferenciado con X en lugar de tick. Requiere columna `was_discarded` en Supabase.

2. **Tag "bloqueada"** — Nuevo tag para tareas que no deben aparecer en Dashboard hasta que se activen manualmente. Aviso flotante al completar una tarea hermana del mismo contenedor que tiene subtareas bloqueadas.

---

## 19. Notas para el Asistente

- **Siempre pedir el archivo antes de modificarlo** — No asumir versión
- **Output siempre a `/mnt/user-data/outputs/`**
- **Colores condicionales**: inline styles con hex, nunca Tailwind dinámico
- **`dark:` prefix primero** en todos los classNames con variante dark/light
- El TaskModal está en **App.tsx** (no en components.tsx)
- `generation.worker.ts` es un archivo nuevo — debe estar en `src/`
- Antes de cualquier fix, verificar en Supabase con SQL si el problema es de datos o de código
- Los logs de debug `[STATS DEBUG]` en DashboardView.tsx deben limpiarse
- App.tsx tiene ~3500 líneas — buscar funciones por nombre antes de editar
