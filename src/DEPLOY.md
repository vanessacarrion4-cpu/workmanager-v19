# 🚀 DEPLOY WORKMANAGER V19 - FIXES

## 📦 ARCHIVOS A REEMPLAZAR

1. **App.tsx** → `src/App.tsx`
2. **utils.ts** → `src/utils.ts`

---

## 🔧 PASOS PARA DEPLOY

### 1️⃣ Reemplazar archivos en tu proyecto local

```bash
# Navega a tu proyecto
cd ~/ruta/a/workmanager-v19

# Reemplaza los archivos (copia desde donde los descargaste)
# App.tsx → src/App.tsx
# utils.ts → src/utils.ts
```

---

### 2️⃣ Commit y push a GitHub

```bash
# Ver cambios
git status

# Añadir archivos modificados
git add src/App.tsx src/utils.ts

# Commit con mensaje descriptivo
git commit -m "fix: 6 bugs corregidos - calendario, recurrencia, dashboard, tags, selección"

# Mensaje detallado (opcional):
# git commit -m "fix: bugs críticos corregidos
# 
# - Calendario muestra tiempo correcto (solo subtareas del día)
# - Campo hora se preserva al activar recurrencia
# - Subtareas recurrentes aparecen en Dashboard
# - Tags se eliminan al convertir en contenedor
# - Botón Seleccionar en vista de bloque individual
# - Verificado handlers de flechas reordenar"

# Push a GitHub (auto-deploy en Vercel)
git push origin master
```

---

### 3️⃣ Verificar deploy en Vercel

1. Ve a https://vercel.com/vanessacarrion4-cpu/workmanager-v19
2. Espera que termine el build (~2-3 minutos)
3. Verifica que esté en "Ready"
4. Abre https://workmanager-v19.vercel.app

---

## ✅ TESTING MANUAL

### Test 1: Contenedor con subtareas recurrentes
1. Ve a vista **Bloques**
2. Crea contenedor "Rutinas Mañana" con tag "con_hora"
3. Añade subtareas:
   - "Bancos" (recurrencia L-V)
   - "Horario Picking" (recurrencia L-V)
   - "Margenes" (recurrencia L-V)
4. **Verificar:**
   - ✅ Tag "con_hora" desaparece del contenedor (correcto, se eliminó)
   - ✅ En Dashboard del lunes aparece contenedor + 3 subtareas expandidas
   - ✅ En Dashboard del sábado NO aparece nada (correcto, solo L-V)

### Test 2: Campo hora en recurrencia
1. Crea tarea "Llamar cliente" con hora 09:00
2. Activa recurrencia "Diaria"
3. **Verificar:**
   - ✅ Campo hora sigue mostrando 09:00 (antes desaparecía)
   - ✅ Puedes modificar la hora y se guarda

### Test 3: Calendario tiempo correcto
1. Ve a vista **Calendar**
2. Busca un día con contenedor + subtareas
3. **Verificar:**
   - ✅ Muestra tiempo solo de subtareas de ese día
   - ✅ NO suma tiempo total del contenedor

### Test 4: Botón Seleccionar en bloque individual
1. Ve a **Bloques**
2. Entra en un bloque (ej: "Cuadro de Mando")
3. **Verificar:**
   - ✅ Aparece botón "Seleccionar" en header
   - ✅ Al hacer click activa modo selección
   - ✅ Puedes seleccionar tareas y usar acciones bulk

### Test 5: Flechas reordenar
1. En vista de bloque individual
2. Prueba flechas ↑↓ en tareas
3. **Verificar:**
   - ✅ Las tareas cambian de orden
   - Si NO funcionan → avisar para debuggear

---

## 🐛 SI ALGO FALLA

### Error al hacer push
```bash
# Si dice "remote changes", hacer pull primero
git pull origin master
# Resolver conflictos si hay
git push origin master
```

### Build falla en Vercel
1. Ve a Vercel → Deployments → click en el deployment fallido
2. Lee el error en "Build Logs"
3. Comparte el error conmigo

### Funcionalidad no funciona
1. Abre DevTools (F12) → Console
2. Busca errores en rojo
3. Comparte screenshot del error

---

## 📞 SOPORTE

Si algo no funciona después del deploy:
1. Screenshots del problema
2. Console errors (F12 → Console)
3. Paso exacto donde falla

¡Listo para deploy! 🚀
