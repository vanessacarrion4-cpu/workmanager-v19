# 🔍 DEBUG AUTO-SELECCIÓN - WorkManager v19

## 🐛 PROBLEMA

Al clickear checkbox de contenedor (ej: "Rutinas Mañana"), NO se auto-seleccionan las subtareas.
Afecta a las 3 vistas: Dashboard, Bloques, Delegadas.

---

## 📋 PASOS PARA DEBUGGEAR

### 1️⃣ Deploy con logs

He añadido console.logs temporales en `toggleTaskSelection` para diagnosticar el problema.

**Deploy:**
```bash
git add src/App.tsx
git commit -m "debug: añadir logs para auto-selección"
git push origin master
```

---

### 2️⃣ Testing con Console abierta

1. **Abre Chrome DevTools:**
   - F12 o Click derecho → Inspeccionar
   - Ve a pestaña "Console"

2. **Prueba en Dashboard:**
   - Ve a Dashboard de un día con "Rutinas Mañana"
   - Click en "Seleccionar"
   - Click en checkbox de "Rutinas Mañana"
   - **Mira Console** → deberías ver logs tipo:
     ```
     [AUTO-SELECT] Task: inst-rutinas-2026-05-04 has subtasks: ['inst-bancos-2026-05-04', 'inst-picking-2026-05-04', ...]
     [AUTO-SELECT] Attempting to select 4 subtasks
     [AUTO-SELECT] Subtask inst-bancos-2026-05-04 exists: true isDeleted: false
     [AUTO-SELECT] Added subtask inst-bancos-2026-05-04
     ...
     [AUTO-SELECT] Selected IDs: ['inst-rutinas-2026-05-04', 'inst-bancos-2026-05-04', ...]
     ```

3. **Prueba en Bloques:**
   - Ve a Bloques → entra en "Cuadro de Mando"
   - Click en "Seleccionar"
   - Click en checkbox de "Rutinas Mañana" (template)
   - **Mira Console** → deberías ver los IDs de templates

4. **Prueba en Delegadas:**
   - Ve a Delegadas
   - Click en "Seleccionar"
   - Click en checkbox de una tarea delegada con subtareas
   - **Mira Console**

---

### 3️⃣ Interpretar resultados

#### ✅ CASO 1: Log dice "No subtasks found"
```
[AUTO-SELECT] Task: inst-rutinas-2026-05-04 has subtasks: undefined
[AUTO-SELECT] No subtasks found for task inst-rutinas-2026-05-04
```

**Problema:** La tarea NO tiene `subtasks` array
**Causa posible:**
- La instancia padre no se generó correctamente
- O el template no tiene subtareas

**Solución:**
- Ve a Bloques → "Rutinas Mañana"
- Verifica que tiene subtareas (Bancos, Picking, etc.)
- Si SÍ tiene → el problema está en `generateInstances()`

---

#### ✅ CASO 2: Log dice "has subtasks: []" (array vacío)
```
[AUTO-SELECT] Task: inst-rutinas-2026-05-04 has subtasks: []
[AUTO-SELECT] Attempting to select 0 subtasks
```

**Problema:** La tarea tiene array vacío
**Causa:** Mismo que Caso 1

---

#### ✅ CASO 3: Log dice "Subtask X exists: false"
```
[AUTO-SELECT] Task: inst-rutinas-2026-05-04 has subtasks: ['inst-bancos-2026-05-04', ...]
[AUTO-SELECT] Attempting to select 4 subtasks
[AUTO-SELECT] Subtask inst-bancos-2026-05-04 exists: false isDeleted: undefined
```

**Problema:** Las subtareas NO están en `tasks` state global
**Causa:** Las instancias de subtareas no se añadieron al state
**Solución:**
- Verificar que `generateInstances()` las está creando
- Verificar que se añaden en el useEffect (línea ~537-542)

---

#### ✅ CASO 4: Log dice "exists: true, isDeleted: true"
```
[AUTO-SELECT] Subtask inst-bancos-2026-05-04 exists: true isDeleted: true
```

**Problema:** La subtarea existe pero está marcada como eliminada
**Causa:** Se eliminó manualmente
**Solución:** Normal, no debería seleccionarse

---

#### ✅ CASO 5: Log dice "Added subtask" PERO visualmente no se marca
```
[AUTO-SELECT] Added subtask inst-bancos-2026-05-04
[AUTO-SELECT] Added subtask inst-picking-2026-05-04
[AUTO-SELECT] Selected IDs: ['inst-rutinas-2026-05-04', 'inst-bancos-2026-05-04', 'inst-picking-2026-05-04']
```

**Problema:** El state se actualiza pero la UI no refleja el cambio
**Causa:** 
- Los checkboxes no están leyendo `selectedTaskIds` correctamente
- O hay un problema de re-render

**Solución:**
- Verificar que TaskCard recibe `selectedTaskIds` como prop
- Verificar que el checkbox usa `selectedTaskIds.has(task.id)`

---

### 4️⃣ Enviarme los logs

Una vez hagas las pruebas, **copia TODOS los logs de Console** y envíamelos.

**Cómo copiar:**
1. Click derecho en Console
2. "Save as..."
3. O simplemente selecciona todo y copia

**Incluye:**
- Logs de Dashboard
- Logs de Bloques  
- Logs de Delegadas

Con eso podré diagnosticar exactamente qué está fallando.

---

## 🔧 POSIBLES SOLUCIONES (después de logs)

### Si el problema es "subtasks: undefined"
→ Arreglar `generateInstances()` para que la instancia padre tenga `subtasks` array

### Si el problema es "exists: false"
→ Verificar que las instancias de subtareas se añaden al state
→ Puede que necesitemos forzar un re-render después de generar

### Si el problema es "UI no refleja cambio"
→ Verificar que `selectedTaskIds` se pasa correctamente
→ Puede que necesitemos usar `key` en TaskCard para forzar re-render

---

## 📝 MIENTRAS TANTO

Puedes usar la app normalmente. Los logs NO afectan el funcionamiento, solo escriben en Console.

Después de debuggear, quitaré los logs y aplicaré el fix definitivo.

---

**Próximo paso:** Deploy → Testing con Console → Enviarme logs 🔍
