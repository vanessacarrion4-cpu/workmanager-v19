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
  
  // Adjuntos
  attachments?: Attachment[]  // Array de adjuntos subidos a Supabase Storage
  
  // Otros
  isDeleted?: boolean         // Soft delete
  isActive?: boolean          // Si el template genera instancias
  existsInSupabase?: boolean  // Marcador en memoria para proteger instancias
  estimatedMinutes: number
  delegation?: { personId, delegatedAt }
  order: number
}

Attachment {
  id: string          // "att-{timestamp}"
  name: string        // Nombre original del fichero
  url: string         // URL pública de Supabase Storage
  type: string        // MIME type (image/jpeg, application/pdf, etc.)
  size: number        // Bytes
  path: string        // Path en el bucket: "{taskId}/{timestamp}.{ext}"
  createdAt: string   // ISO timestamp
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

**✅ FIX APLICADO**: `repairContainersWithForbiddenData` tiene guard `if (!task.isTemplate) return;` — solo limpia templates, nunca instancias ni tareas manuales.

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

**✅ FIX APLICADO**: Añadido `.sort((a, b) => (a.order ?? 999) - (b.order ?? 999))` al final para respetar el campo `order`.

---

## 6. Vistas

### Dashboard (`DashboardView.tsx`)
- Vista principal del día
- Muestra tareas agrupadas por tag: Con Hora, Focus, Dirección, En Espera, Resto
- Navegación por días con `activeDate`
- Stats: tareas completadas, tiempo estimado, tiempo registrado
- Modal "Tiempo Registrado" (`TimeEntryItem`) — muestra historial del día
- **Drag & drop** con `Reorder` de framer-motion para reordenar tareas por tag
- Persistencia de orden a Supabase en batch al soltar

### Bloques (`BlocksView.tsx`)
- Gestión de tareas por bloque
- Aquí se crean templates con subtareas recurrentes
- Vista de árbol con drag & drop (`Reorder.Item`) para reordenar

### Calendario (`CalendarView.tsx`)
- Vista mensual con indicadores de carga por día
- Color coding por bloques
- Resumen semanal

### Delegadas (`DelegadasView.tsx`)
- Accordion por persona
- Tareas asignadas a cada persona con flechitas ▲▼ para reordenar (contenedores y subtareas)
- Sistema de reuniones con notas formateadas

### Búsqueda (`SearchView.tsx`)
- Búsqueda global con filtros avanzados

### Carga de Trabajo (`WorkloadView.tsx`)
- Vista por bloques con barras de carga
- Meses como columnas expandibles → semanas → días

---

## 7. Guardado de Datos en Supabase

### Guardar estado de tarea (completar/editar)
```typescript
// En App.tsx: handleToggleStatus, handleUpdateTask
// Si es instancia normal → crear excepción (is_exception:true) y guardar
// Si es template → actualizar directamente
// IMPORTANTE: dbTask incluye el campo attachments
```

### Guardar time entries
```typescript
// IMPORTANTE: las instancias en memoria tienen IDs tipo "inst-t-xxx-2026-05-13"
// Estos IDs NO existen en Supabase → error FK
// Fix: resolver el templateId antes de guardar
const resolveIdForDB = (id: string) => {
  if (!id.startsWith('inst-')) return id;
  const task = tasks[id];
  return task?.templateId || id;
};
```

### Reordenar tareas
```typescript
// handleUpdateTasksOrder — persiste order de cada tarea en Supabase
// handleUpdateSubtasksOrder — persiste order de cada subtarea en Supabase
// Ambos actualizan el campo order individualmente por tarea con supabase.from('tasks').update({ order })
```

### Adjuntos (Supabase Storage)
```typescript
// Bucket: 'task-attachments' (público)
// Path: "{taskId}/{timestamp}.{ext}"
// handleUploadAttachment(taskId, file) — sube fichero y actualiza task.attachments
// handleDeleteAttachment(taskId, attachmentId, path) — borra de Storage y actualiza task.attachments
// Los attachments se guardan como JSONB en la columna tasks.attachments
```

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
2. **Time entries no se guardan en instancias recurrentes** — Error FK. **Fix**: `resolveIdForDB()`.
3. **Títulos `INST-T-xxx` en modal Tiempo Registrado** — **Fix**: `getTaskTitle()` busca título real vía templateId.
4. **`repairContainersWithForbiddenData` borraba datos de tareas normales** — **Fix**: guard `if (!task.isTemplate) return;`.

### ✅ Resueltos en sesión 14/05/2026

5. **Tareas duplicadas en Dashboard** — Instancias excepción con `due_date=null` (borrado por repair) aparecían cada día. **Fix**: UPDATE en Supabase `SET due_date = instance_date WHERE template_id IS NOT NULL AND is_exception = true AND due_date IS NULL`. También fix en `repairContainersWithForbiddenData` con guard `isTemplate`.
6. **Notas no persistían** — `useEffect([task])` en TaskModal reseteaba `localTask` en cada re-render. **Fix**: `useEffect([task.id])`.
7. **Timer stop usaba `prompt()` nativo** — Reemplazado por `TimerStopModal` con nota + checkbox "Marcar como completada".
8. **Registro tiempo manual sin opción completar** — Añadido checkbox en `TimeManagementPanel`.
9. **Reordenar subtareas no funcionaba** — `getVisibleSubtasksForDay` no ordenaba por `order`. **Fix**: `.sort()` añadido. También `handleUpdateSubtasksOrder` ahora actualiza `order` de cada subtarea individualmente.
10. **Drag & drop en Dashboard** — Implementado con `Reorder.Group/Item` de framer-motion. Persiste a Supabase en batch.
11. **Reordenar en Bloques** — `Reorder.Item` añadido en TaskCards de adhocTasks y coreTasks. `handleUpdateTasksOrder` persiste a Supabase.
12. **Reordenar en Delegadas** — Flechitas ▲▼ para contenedores y subtareas, persistencia batch a Supabase.
13. **Adjuntos no persistían al recargar** — `attachments` faltaba en `dbTask` del upsert y en el mapeo de `useSupabase.ts`. **Fix**: ambos corregidos.

### ⚠️ Bugs Pendientes

1. **Subtareas duplicadas en Dashboard** — Contenedores con mezcla de subtareas recurrentes + manuales pueden mostrar subtareas duplicadas en casos edge.
2. **Contenedores recurrentes con subtareas manuales** — Subtareas manuales con fecha fija dentro de template pueden generar instancias que no deberían. Fix pendiente en `utils.ts` `generateInstances()`.

---

## 11. Reglas de Negocio Importantes

1. **Templates nunca aparecen en Dashboard** — `isTemplate:true` los bloquea en `filterTasksForDay`
2. **Subtareas nunca aparecen solas** — Solo bajo su contenedor padre
3. **Delegadas sin tag real se ocultan** — Solo las de tag 'resto' se filtran (hideDelegatedNoTag)
4. **Contenedor desaparece cuando todas sus subtareas están completadas** — A menos que `hideCompleted:false`
5. **Instancias no se guardan en Supabase** — Solo las excepciones (`isException:true`)
6. **El `order` de las tareas se guarda en Supabase** — `handleUpdateTasksOrder` y `handleUpdateSubtasksOrder` actualizan el campo en batch
7. **Zona horaria**: Barcelona UTC+2 (verano). Los timestamps de Supabase son UTC.
8. **Los contenedores NUNCA tienen recurrencia propia** — La recurrencia va en las subtareas. Un contenedor con subtareas recurrentes se marca `isTemplate:true`.

---

## 12. Componentes Clave (`components.tsx`)

- `TaskCard` — Tarjeta de tarea con chips de fecha, tags, tiempo, delegación. Variantes: COMPACT, FULL/DASHBOARD. Muestra icono 📎 si hay adjuntos.
- `TimeManagementPanel` — Panel de registro de tiempo con historial. Tiene checkbox "Marcar como completada".
- `TimerStopModal` — Modal al parar el cronómetro: nota + checkbox completar (reemplaza el `prompt()` nativo).
- `BlockModal` — Modal de creación/edición de bloques.
- `RecurrenceChoiceModal` — "¿Editar solo esta instancia o todas?"
- `DashboardHarmonicCalendar` — Mini calendario del header.
- `BulkActionBar` — Barra de acciones masivas (modo selección).
- `MonthDatePicker` — Selector de fecha mensual.

---

## 13. Convenciones de IDs

- Tareas manuales: `t-{Date.now()}` ej: `t-1778617274921`
- Templates: igual que manuales pero con `isTemplate:true`
- Instancias: `inst-{templateId}-{YYYY-MM-DD}` ej: `inst-t-1778445069239-2026-05-13`
- Time entries: `te-{Date.now()}` ej: `te-1778605149442`
- Adjuntos: `att-{Date.now()}` ej: `att-1778794916575`
- Bloques: `b{n}` para los iniciales, `b-{timestamp}` para los creados

---

## 14. Supabase Storage — Adjuntos

- **Bucket**: `task-attachments` (público)
- **Política**: Allow all operations, `true` (sin restricciones, uso personal)
- **Columna en tasks**: `attachments JSONB DEFAULT '[]'`
- **Estructura de cada adjunto**:
```json
{
  "id": "att-1778794916575",
  "name": "documento.pdf",
  "url": "https://yewfmfoljidvrxvbrsdv.supabase.co/storage/v1/object/public/task-attachments/t-xxx/1778794915581.pdf",
  "type": "application/pdf",
  "size": 98806,
  "path": "t-xxx/1778794915581.pdf",
  "createdAt": "2026-05-14T21:41:56.575Z"
}
```
- Las imágenes se muestran como miniatura en el modal. Los otros ficheros como icono + nombre + tamaño.
- Carga bajo demanda (solo al abrir el modal), no al arrancar la app.

---

## 15. Flujo de Debugging

Cuando algo no aparece en el Dashboard:
1. Verificar en Supabase que la tarea existe y tiene los campos correctos
2. Verificar que `template_id IS NULL OR is_exception = true` (la query la carga)
3. Verificar count total vs count cargado (problema paginación)
4. Añadir log `[DIAGNÓSTICO]` en `useSupabase.ts` después de las reparaciones
5. Filtrar consola por `SUPABASE`, `REPAIR`, `GENERATION`, `DIAGNÓSTICO`

Cuando el tiempo registrado no se guarda:
1. Filtrar consola por `SUPABASE` al guardar
2. Si error FK `time_entries_task_id_fkey` → el `task_id` es una instancia en memoria, usar templateId

Cuando el orden no persiste:
1. Verificar que `handleUpdateTasksOrder` o `handleUpdateSubtasksOrder` se llama
2. Verificar en Supabase que el campo `order` se actualiza en la tabla `tasks`

---

## 16. Variables de Entorno (Vercel)

```
VITE_SUPABASE_URL=https://yewfmfoljidvrxvbrsdv.supabase.co
VITE_SUPABASE_ANON_KEY={clave anon de Supabase}
```

---

## 17. Estado Actual de Archivos (14/05/2026)

| Archivo | Última modificación | Estado |
|---------|--------------------|----|
| App.tsx | 14/05/2026 | Adjuntos, TimerStopModal, fix notas, fix order, fix duplicados |
| useSupabase.ts | 14/05/2026 | Fix attachments mapeo, fix repairContainers isTemplate guard |
| filters.ts | 14/05/2026 | Sort por order en getVisibleSubtasksForDay |
| components.tsx | 14/05/2026 | Icono paperclip, checkbox completar en tiempo, drag subtareas |
| DashboardView.tsx | 14/05/2026 | Drag & drop Reorder.Group/Item, persistencia Supabase |
| BlocksView.tsx | 14/05/2026 | Reorder.Item en TaskCards |
| DelegadasView.tsx | 14/05/2026 | Flechitas ▲▼ en subtareas, persistencia Supabase |
| utils.ts | 11/05/2026 | Fix subtareas manuales en contenedores recurrentes |
| CalendarView.tsx | 09/05/2026 | Color coding, load indicators |
| WorkloadView.tsx | 10/05/2026 | Rediseño Opción A |

---

## 18. Notas para el Asistente

- **Siempre pedir el archivo antes de modificarlo** — No asumir versión del archivo
- **Aplicar cambios directamente sobre archivos subidos** — Output a `/mnt/user-data/outputs/`
- **Usar inline styles con hex values** para colores condicionales (no Tailwind dinámico)
- **No hacer cambios parciales** — Siempre entregar el archivo completo
- **Antes de cualquier fix, verificar en Supabase** con SQL si el problema es de datos o de código
- La app tiene ~3500 líneas en App.tsx — buscar funciones por nombre antes de editar
- El TaskModal está en App.tsx (no en components.tsx)
- `TimerStopModal` es un componente independiente al final de App.tsx
