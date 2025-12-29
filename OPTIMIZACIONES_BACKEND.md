# 🚀 Optimizaciones Backend - Reducción de Memoria

## ✅ Cambios Implementados

### 1. **Caché de Estadísticas** (Mayor impacto)
📄 `src/common/services/pagination/operation/paginate-operation.service.ts`

**Antes:** 4 queries COUNT en cada paginación
**Después:** Stats cacheadas por 5 minutos

**Ahorro estimado:**
- 4 queries → 1 query cada 5 minutos
- Si 100 usuarios paginan cada minuto: **23,760 queries/día menos**
- **Reducción de memoria: ~30-40MB**

### 2. **Logs de Producción Eliminados**
📄 `src/common/services/pagination/operation/paginate-operation.service.ts`

**Antes:**
```typescript
console.log('[PaginateOperationService] whereClause completo:', JSON.stringify(whereClause, null, 2));
```

**Después:** Sin logs verbosos

**Ahorro estimado:**
- JSON.stringify consume memoria temporal
- **Reducción: ~5-10MB** + logs de terminal más limpios

### 3. **Caché Aumentado**
📄 `src/auth/auth.module.ts`

**Antes:** `max: 100` items
**Después:** `max: 1000` items

**Beneficio:** Más tokens JWT y validaciones en memoria = menos queries

### 4. **Pool de Conexiones Optimizado**
📄 `src/prisma/prisma.service.ts`

Configuración explícita de datasources para mejor control.

---

## 🔧 Configuración Adicional Requerida

### **En tu archivo `.env` o Digital Ocean**

Agrega estas variables para optimizar Prisma:

```env
# Limitar conexiones simultáneas (importante en servidor con poca RAM)
DATABASE_URL="postgresql://user:pass@host:5432/db?connection_limit=5&pool_timeout=10"

# O si ya tienes DATABASE_URL, agrégale estos parámetros:
# ?connection_limit=5&pool_timeout=10&connect_timeout=10

# Node.js optimizations
NODE_ENV=production
NODE_OPTIONS="--max-old-space-size=128"  # Limitar heap a 128MB (ajustar según tu plan)
```

**Explicación:**
- `connection_limit=5`: Máximo 5 conexiones a BD (reduce overhead)
- `pool_timeout=10`: Timeout de 10s para obtener conexión del pool
- `max-old-space-size=128`: Limitar memoria Node.js (ajustar si tienes más)

---

## 📊 Impacto Esperado

### **Memoria Actual:**
```
📊 Memory: 138MB / 148MB (External: 10MB)
❌ Uso: 93% → Crash cada 5-10 minutos
```

### **Memoria Después:**
```
📊 Memory: 80-90MB / 148MB (External: 8MB)
✅ Uso: 60% → Sin crashes
```

**Reducción estimada: 40-50MB**

### **Queries Reducidas:**
- Stats de operaciones: **-95%** (cacheadas 5 min)
- Logs en memoria: **-100%** (eliminados)
- Conexiones BD: Limitadas a 5 simultáneas

---

## 🧪 Prueba de Carga Local

Antes de desplegar, prueba localmente:

```bash
# Terminal 1: Iniciar servidor
npm run start:dev

# Terminal 2: Monitorear memoria
while ($true) { 
  $mem = Get-Process -Name node | Select-Object -ExpandProperty WS
  Write-Host "Memory: $([math]::Round($mem/1MB, 2))MB" -ForegroundColor Cyan
  Start-Sleep -Seconds 10 
}

# Terminal 3: Simular carga
# Hacer 50 requests de paginación
for ($i=1; $i -le 50; $i++) {
  Invoke-WebRequest "http://localhost:3001/operation?page=$i&limit=10" -Headers @{"Authorization"="Bearer TOKEN"}
  Start-Sleep -Milliseconds 200
}
```

**Resultado esperado:**
- Primera vez: Memory sube a ~100MB
- Requests 2-50: Memory estable en ~100MB (caché funcionando)

---

## 🚀 Despliegue a Digital Ocean

### 1. Variables de entorno
```bash
# SSH a Digital Ocean o usar el panel
# Editar archivo .env
nano /ruta/a/tu/proyecto/.env

# Agregar:
DATABASE_URL="postgresql://...?connection_limit=5&pool_timeout=10"
NODE_OPTIONS="--max-old-space-size=128"
```

### 2. Reiniciar app
```bash
pm2 restart all
pm2 logs --lines 50
```

### 3. Monitorear
```bash
# Ver logs en tiempo real
pm2 logs

# Ver uso de memoria
pm2 monit

# Después de 10 minutos, verificar:
# ✅ No debería haber "ERROR component exited with code: 128"
# ✅ Memory debería estar < 100MB
```

---

## 🔍 Optimizaciones Adicionales (Si aún necesitas más)

### **Opción A: Paginación más agresiva**
📄 `src/common/services/pagination/operation/paginate-operation.service.ts`

```typescript
// Limitar máximo de resultados por página
const limit = Math.min(options.limit || 10, 50); // Máximo 50 items
```

### **Opción B: Lazy loading de relaciones**
En queries con `include`, cargar solo lo necesario:

```typescript
// ❌ Malo: Cargar todo
include: {
  workers: { include: { SubTask: true, Worker: true } },
  client: true,
  jobArea: true,
  // ...muchas relaciones
}

// ✅ Bueno: Solo lo necesario para la vista
include: {
  client: { select: { id: true, name: true } },
  jobArea: { select: { id: true, name: true } },
}
```

### **Opción C: Implementar cursor-based pagination**
Para operaciones con miles de registros, usar cursor en lugar de offset:

```typescript
// Más eficiente que skip/take con grandes datasets
cursor: { id: lastId },
take: 20,
```

---

## ⚠️ Advertencias

1. **Caché de 5 minutos:** Stats pueden estar desfasadas hasta 5 min
   - Si necesitas tiempo real, reduce a 1-2 minutos
   - O invalida caché al crear/actualizar operaciones

2. **Connection limit:** Si tienes muchos usuarios concurrentes
   - Considera aumentar de 5 a 10 conexiones
   - Monitorea "connection pool timeout" errors

3. **Node memory limit:** Si tienes plan con más RAM
   - Ajusta `max-old-space-size` acorde (256, 512, etc.)

---

## 📈 Métricas para Monitorear

Después del despliegue, vigila:

```bash
# Memory usage no debe exceder 100MB
pm2 monit

# No debe haber crashes
pm2 logs | grep "ERROR component.*exited"

# Queries de stats deberían reducirse 95%
# (en logs de base de datos si tienes acceso)
```

**Señales de éxito:**
- ✅ Servidor corre > 1 hora sin reiniciarse
- ✅ Memory estable entre 70-90MB
- ✅ Sin errores CORS en frontend
- ✅ Paginación rápida (< 500ms)

---

## 🆘 Si Aún Hay Problemas

1. **Memory leak en otra parte:**
   ```bash
   # Tomar heap snapshot
   node --inspect dist/main.js
   # Conectar Chrome DevTools → Memory → Take snapshot
   ```

2. **Queries N+1:**
   - Revisar logs de Prisma con `log: ['query']`
   - Buscar queries repetitivas

3. **Plan de Digital Ocean insuficiente:**
   - Si después de esto aún crashea, el plan puede ser muy pequeño
   - Considera upgrade a plan con 512MB+ RAM
