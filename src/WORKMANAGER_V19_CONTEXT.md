# WorkManager v19 — Documento de Contexto Completo

> Usar este documento al inicio de cada sesión de desarrollo para dar contexto completo al asistente.

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
├── App.tsx                 # Componente raíz. Estado global, handlers, routing entre vistas
├── types.ts                # Interfaces TypeScript: Task, WorkBlock, TimeEntry, Person, etc.
├── constants.ts            # INITIAL_BLOCKS, COLORS, TAG_LABELS
├── supabaseClient.ts       # Inicialización cliente Supabase
├── dateUtils.ts            # formatLocalISO(), parseLocalISO()
├── utils.ts                # generateInstances(), isTaskCompleted(), projectLoad(), etc.
├── filters.ts              # filterTasksForDay(), groupTasksByTag(), getStatsForDay()
├── useSupabase.ts          # Hook: carga inicial desde Supabase + reparaciones
├── useGeneration.ts        # Hook: genera instancias recurrentes en memoria
├── useSupabaseData.ts      # Hook legacy (no usado activamente)
├── DashboardView.tsx       # Vista principal del día
├── BlocksView.tsx          # Vista de gestión de bloques y tareas
├── CalendarView.tsx        # Vista de calendario mensual
├── DelegadasView.tsx       # Vista de tareas delegadas por persona
├── SearchView.tsx          # Búsqueda global de tareas
├── WorkloadView.tsx        # Vista de carga de trabajo por bloques
├── components.tsx          # Todos los componentes reutilizables
├── main.tsx                # Entry point React
└── index.css               # Tailwind + scrollbar custom
```

---

## 3. Arquitectura de Datos

### Tablas Supabase
- `work_blocks` — Bloques de trabajo (9 bloques, ej: Cuadro de Mando, RRHH, Contratos...)
- `tasks` — Todas las tareas: templates, manuales, instancias excepción
- `persons` — Personas para delegación (5 personas)
- `time_entries` — Registros de tiempo
- `meetings` — Reuniones de delegación

### Modelo de Tareas (arquitectura clave)

```
Task {
  id: string                  // "t-{timestamp}" o "inst-{templateId}-{date}"
  blockId: string             // A qué bloque pertenece
  title: string
  status: 'pending' | 'completed'
  dueDate: string | null      // YYYY-MM-DD
  tags: TagType[]             // 'con_hora' | 'focus' | 'dirección' | 'espera' | 'resto'
  
  // Jerarquía
  parentTaskId?: string       // ID del padre (si es subtarea)
  subtasks?: string[]         // IDs de hijos directos
  
  // Recurrencia
  isTemplate?: boolean        // true = plantilla maestra, no se muestra en Dashboard
  templateId?: string         // ID del template del que viene esta instancia
  instanceDate?: string       // Fecha a la que pertenece esta instancia
  isException?: boolean       // true = instancia modificada individualmente, guardada en Supabase
  recurrence?: {...}          // Configuración de recurrencia (en subtareas)
  
  // Otros
  isDeleted?: boolean         // Soft delete
  isActive?: boolean          // Si el template genera instancias
  existsInSupabase?: boolean  // Marcador en memoria para proteger instancias
  estimatedMinutes: number
  delegation?: { personId, delegatedAt }
  order: number
}
```

### Flujo de Recurrencia

```
Template (isTemplate:true, en Supabase)
  └── Subtarea template (isTemplate:true, recurrence:{...}, en Supabase)
  
→ useGeneration genera en memoria:
  
inst-{templateId}-{fecha} (isTemplate:false, solo en memoria)
  └── inst-{subTemplateId}-{fecha} (isTemplate:false, solo en memoria)
```

**REGLA CRÍTICA**: Las instancias normales NO se guardan en Supabase. Solo se guardan si el usuario las modifica individualmente (`isException: true`).

### Carga desde Supabase

La query carga solo:
- Tareas con `template_id IS NULL` (templates y tareas manuales)
- Tareas con `is_exception = true` (instancias modificadas)

**Con paginación** (PostgREST tiene límite de 1000 filas por defecto):
```typescript
while (true) {
  const { data } = await supabase.from('tasks').select('*')
    .or('template_id.is.null,is_exception.eq.true')
    .range(from, from + 999);
  // acumular y paginar hasta obtener todo
}
```

---

## 4. Hooks Principales

### `useSupabase.ts`
Carga inicial al montar la app:
1. Carga bloques, tareas (paginadas), personas, time_entries, meetings
2. Reconstruye jerarquía en 3 pasadas: `reconstructHierarchy`, `reconstructInstanceHierarchy`, `reconstructExceptionContainerSubtasks`
3. Reparaciones automáticas: `repairContainersWithForbiddenData`, `repairRecurringContainers`
4. Limpieza automática: borra instancias `is_deleted:true` de más de 30 días

**⚠️ IMPORTANTE**: `repairContainersWithForbiddenData` tiene un bug conocido — limpia `dueDate`, `tags`, etc. de CUALQUIER contenedor con subtareas. Debería limitar a `isTemplate:true` únicamente. **Fix pendiente de aplicar en producción.**

### `useGeneration.ts`
Se ejecuta cuando cambia `templateKey` (hash de los templates):
1. Limpia instancias en memoria fuera de ventana ±30/365 días
2. Genera instancias nuevas con `generateInstances()`
3. Merge con instancias existentes de Supabase (PASO2)
4. Vincula subtareas a sus contenedores (PASO3)

**REGLA CRÍTICA**: Solo modifica instancias (`templateId` presente). NUNCA templates. Modificar templates → cambia templateKey → bucle infinito.

---

## 5. Filtrado y Agrupación (filters.ts)

### `filterTasksForDay(tasks, allTasksMap, activeBlockIds, activeDate, options)`
Devuelve tareas raíz para mostrar en un día. Reglas:
- ❌ Borradas (`isDeleted:true`)
- ❌ Templates (`isTemplate:true`)
- ❌ Subtareas solas (tienen `parentTaskId`)
- ❌ Bloques inactivos
- ✅ Tarea con `dueDate === activeDate`
- ✅ Contenedor sin dueDate con ≥1 subtarea pendiente ese día

### `groupTasksByTag(dayTasks, allTasksMap, activeDate, options)`
Agrupa por etiqueta. **Importante**: un contenedor puede aparecer en múltiples grupos si sus subtareas tienen diferentes tags. Esto es intencionado.

### `getVisibleSubtasksForDay(container, allTasksMap, activeDate, options)`
Obtiene subtareas visibles de un contenedor para un día. Busca por dos caminos:
- Instancias recurrentes: `task.templateId` → `subtaskTemplate.parentTaskId === containerTemplateId`
- Subtareas manuales: `task.parentTaskId === container.id || task.parentTaskId === containerTemplateId`

**⚠️ BUG CONOCIDO**: Puede devolver subtareas duplicadas cuando una subtarea manual está dentro de un contenedor recurrente. Tiene un `Set` para dedup pero no siempre funciona en todos los casos.

---

## 6. Vistas

### Dashboard (`DashboardView.tsx`)
- Vista principal del día
- Muestra tareas agrupadas por tag: Con Hora, Focus, Dirección, En Espera, Resto
- Navegación por días con `activeDate`
- Stats: tareas completadas, tiempo estimado, tiempo registrado
- Modal "Tiempo Registrado" (`TimeEntryItem`) — muestra historial del día

### Bloques (`BlocksView.tsx`)
- Gestión de tareas por bloque
- Aquí se crean templates con subtareas recurrentes
- Vista de árbol con drag & drop para reordenar

### Calendario (`CalendarView.tsx`)
- Vista mensual con indicadores de carga por día
- Color coding por bloques
- Resumen semanal

### Delegadas (`DelegadasView.tsx`)
- Accordion por persona
- Tareas asignadas a cada persona
- Sistema de reuniones con notas formateadas

### Búsqueda (`SearchView.tsx`)
- Búsqueda global con filtros avanzados
- Filtros: tags, estado, tipo, fechas, recurrencia, tiempo estimado

### Carga de Trabajo (`WorkloadView.tsx`)
- Vista por bloques con barras de carga
- Meses como columnas expandibles → semanas → días
- Por defecto contraído

---

## 7. Guardado de Datos en Supabase

### Guardar estado de tarea (completar/editar)
```typescript
// En App.tsx: handleToggleStatus, handleUpdateTask
// Si es instancia normal → crear excepción (is_exception:true) y guardar
// Si es template → actualizar directamente
```

### Guardar time entries
```typescript
// IMPORTANTE: las instancias en memoria tienen IDs tipo "inst-t-xxx-2026-05-13"
// Estos IDs NO existen en Supabase → error FK
// Fix: resolver el templateId antes de guardar
const resolveIdForDB = (id: string) => {
  if (!id.startsWith('inst-')) return id;
  const task = tasks[id];
  return task?.templateId || id; // usar templateId si existe
};
```

### Error FK en time_entries
**Error conocido**: `time_entries_task_id_fkey` — el `task_id` de una instancia generada en memoria no existe en la tabla `tasks`. Fix aplicado en `handleManualTimeEntry` y en el timer stop handler.

---

## 8. Bloques de Trabajo

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

## 9. Tags

| Tag | Label | Descripción |
|-----|-------|-------------|
| `con_hora` | Con Hora | Tareas con hora fija |
| `focus` | Focus | Tareas prioritarias de concentración |
| `dirección` | Dirección | Decisiones estratégicas |
| `espera` | En Espera | Bloqueadas esperando respuesta |
| `resto` | Resto | Sin clasificar |

---

## 10. Bugs Conocidos y Fixes Pendientes

### ✅ Resueltos en sesión 12/05/2026

1. **Tareas que desaparecen** — PostgREST límite 1000 filas + `.order()` dejaba tareas fuera. **Fix**: paginación + sin `.order()` en query de tareas.

2. **Time entries no se guardan en instancias recurrentes** — Error FK porque `task_id` era un ID de instancia en memoria. **Fix**: `resolveIdForDB()` en `handleManualTimeEntry` y timer stop.

3. **Títulos `INST-T-xxx` en modal Tiempo Registrado** — `TimeEntryItem` mostraba el ID de instancia. **Fix**: `getTaskTitle()` busca título real vía templateId.

4. **`repairContainersWithForbiddenData` borraba datos de tareas normales** — Actuaba sobre cualquier contenedor con subtareas. **Fix**: añadir `if (!task.isTemplate) return;` al inicio de la función.

### ⚠️ Bugs Pendientes / En Curso

1. **Subtareas duplicadas en Dashboard** — Contenedores con mezcla de subtareas recurrentes + manuales pueden mostrar subtareas duplicadas. Causa: `getVisibleSubtasksForDay` encuentra la misma subtarea por dos caminos (ID directo + templateId). El `Set` de dedup no siempre funciona cuando la instancia del contenedor tiene `subtasks:[]`.

2. **`repairContainersWithForbiddenData` sin fix isTemplate** — El `useSupabase.ts` en producción todavía tiene la versión sin el guard `if (!task.isTemplate) return;`. Hay que verificar si el fix está en el commit actual.

3. **Contenedores recurrentes con subtareas manuales** — Cuando un template tiene subtareas recurrentes Y subtareas manuales con fecha fija, las manuales pueden generar instancias `inst-t-xxx-{fecha}` que no deberían existir. Fix en `utils.ts` `generateInstances()`: subtareas manuales con `dueDate === dateStr` deben añadirse directamente al `subtaskInstanceIds` sin crear instancia.

---

## 11. Reglas de Negocio Importantes

1. **Templates nunca aparecen en Dashboard** — `isTemplate:true` los bloquea en `filterTasksForDay`
2. **Subtareas nunca aparecen solas** — Solo bajo su contenedor padre
3. **Delegadas sin tag real se ocultan** — Solo las de tag 'resto' se filtran (hideDelegatedNoTag)
4. **Contenedor desaparece cuando todas sus subtareas están completadas** — A menos que `hideCompleted:false`
5. **Instancias no se guardan en Supabase** — Solo las excepciones (`isException:true`)
6. **El `order` de las tareas se guarda en Supabase** — `handleUpdateTasksOrder` actualiza el campo
7. **Zona horaria**: Barcelona UTC+2 (verano). Los timestamps de Supabase son UTC.

---

## 12. Componentes Clave (`components.tsx`)

- `TaskCard` — Tarjeta de tarea con chips de fecha, tags, tiempo, delegación
- `TimeManagementPanel` — Panel de registro de tiempo con historial
- `BlockModal` — Modal de creación/edición de bloques
- `RecurrenceChoiceModal` — "¿Editar solo esta instancia o todas?"
- `DashboardHarmonicCalendar` — Mini calendario del header
- `BulkActionBar` — Barra de acciones masivas (modo selección)
- `MonthDatePicker` — Selector de fecha mensual

---

## 13. Convenciones de IDs

- Tareas manuales: `t-{Date.now()}` ej: `t-1778617274921`
- Templates: igual que manuales pero con `isTemplate:true`
- Instancias: `inst-{templateId}-{YYYY-MM-DD}` ej: `inst-t-1778445069239-2026-05-13`
- Time entries: `te-{Date.now()}` ej: `te-1778605149442`
- Bloques: `b{n}` para los iniciales, `b-{timestamp}` para los creados

---

## 14. Flujo de Debugging

Cuando algo no aparece en el Dashboard:
1. Verificar en Supabase que la tarea existe y tiene los campos correctos
2. Verificar que `template_id IS NULL OR is_exception = true` (la query la carga)
3. Verificar count total vs count cargado (problema paginación)
4. Añadir log `[DIAGNÓSTICO]` en `useSupabase.ts` después de las reparaciones
5. Filtrar consola por `SUPABASE`, `REPAIR`, `GENERATION`, `DIAGNÓSTICO`

Cuando el tiempo registrado no se guarda:
1. Filtrar consola por `SUPABASE` al guardar
2. Si error FK `time_entries_task_id_fkey` → el `task_id` es una instancia en memoria, usar templateId

---

## 15. Variables de Entorno (Vercel)

```
VITE_SUPABASE_URL=https://yewfmfoljidvrxvbrsdv.supabase.co
VITE_SUPABASE_ANON_KEY={clave anon de Supabase}
```

---

## 16. Estado Actual de Archivos (12/05/2026 22:35)

| Archivo | Última modificación | Estado |
|---------|--------------------|----|
| App.tsx | 12/05/2026 22:12 | Fix resolveIdForDB para time entries |
| useSupabase.ts | 12/05/2026 21:54 | Fix paginación + sin .order() |
| filters.ts | 12/05/2026 22:35 | Fix dedup Set en getVisibleSubtasksForDay |
| utils.ts | 11/05/2026 8:07 | Fix subtareas manuales en contenedores recurrentes |
| DashboardView.tsx | 12/05/2026 21:40 | Fix TimeEntryItem getTaskTitle() |
| components.tsx | 10/05/2026 0:55 | Fix hasSubtasks null check |
| BlocksView.tsx | 10/05/2026 22:25 | searchQuery añadido |
| CalendarView.tsx | 09/05/2026 23:50 | Color coding, load indicators |
| DelegadasView.tsx | 10/05/2026 0:51 | Vista delegadas completa |
| WorkloadView.tsx | 10/05/2026 21:11 | Rediseño Opción A |

---

## 17. Notas para el Asistente

- **Siempre pedir el archivo antes de modificarlo** — No asumir versión del archivo
- **Aplicar cambios directamente sobre archivos subidos** — Output a `/mnt/user-data/outputs/`
- **Usar inline styles con hex values** para colores condicionales (no Tailwind dinámico)
- **No hacer cambios parciales** — Siempre entregar el archivo completo
- **Antes de cualquier fix, verificar en Supabase** con SQL si el problema es de datos o de código
- La app tiene ~3400 líneas en App.tsx — buscar funciones por nombre antes de editar
