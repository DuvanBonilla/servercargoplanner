# 📚 Guía de Consumo del Endpoint de Bills Paginadas

## 🔍 Endpoint Principal
```
GET /bill/paginated
```

## 📋 Parámetros de Consulta Disponibles

### **Búsqueda (search)**
- **Tipo**: string (opcional)
- **Descripción**: Busca en **TODOS los 1639+ registros disponibles** antes de paginar
- **⚠️ IMPORTANTE**: La búsqueda NO está limitada a los primeros 500 registros
- **Cómo funciona**: 
  1. Aplica la búsqueda a TODA la base de datos
  2. Cuenta cuántos registros coinciden
  3. DESPUÉS aplica la paginación a los resultados filtrados
- **Busca en**:
  - ID de Operación (búsqueda exacta si es número)
  - Nombre del Cliente
  - Nombre del Área
  - Código de Tarifa (numérico, ej: 18401)
  - Nombre de Subtarea (ej: "Apoyo en inspección antinarcóticos")

### **Filtros Disponibles**
- `search`: Término de búsqueda
- `jobAreaId`: ID del área de trabajo (número)
- `status`: Estado de la factura (**SOLO** `ACTIVE` o `COMPLETED`)
- `dateStart`: Fecha de inicio (formato YYYY-MM-DD)
- `dateEnd`: Fecha de fin (formato YYYY-MM-DD)
- `page`: Página actual (default: 1)
- `limit`: Elementos por página (default: 10, max: 500)

### **⚠️ ¡MUY IMPORTANTE! - Búsqueda vs Paginación**

**✅ LA BÚSQUEDA SE APLICA A TODOS LOS REGISTROS:**
- Si buscas `search=18401`, el sistema buscará en TODOS los 1639+ registros
- Si encuentra 100 coincidencias, podrás navegar por todas las 100 en páginas
- El `limit=500` NO limita la búsqueda, solo cuántos resultados mostrar por página

**Ejemplo práctico:**
```javascript
// Si hay 1639 facturas y buscas por operación 389:
fetch('/bill/paginated?search=389&limit=100')
// 1. Busca '389' en LOS 1639 registros
// 2. Encuentra (por ejemplo) 5 coincidencias
// 3. Te muestra las 5 en una sola página
// 4. NO está limitado a buscar solo en los primeros 100
```

### **⚠️ Estados de Factura Disponibles**
- `ACTIVE`: Factura activa/pendiente
- `COMPLETED`: Factura completada/finalizada

*Nota: El status es de la **factura**, no de la operación*

## 🚀 Ejemplos de Uso

### 1️⃣ **Buscar por ID de Operación**
```javascript
// ✅ CORRECTO - Búsqueda por ID de operación 389 EN TODOS LOS REGISTROS
const response = await fetch('/bill/paginated?search=389&page=1&limit=100');
// Esto buscará '389' en TODOS los 1639+ registros, no solo en los primeros 100
```

```bash
# Ejemplo en cURL
curl "http://localhost:3000/bill/paginated?search=389&page=1&limit=10" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 2️⃣ **Buscar por Código de Subservicio**
```javascript
// ✅ CORRECTO - Búsqueda por código numérico de subtask EN TODOS LOS REGISTROS
const response = await fetch('/bill/paginated?search=18401&page=1&limit=100');
// Esto encontrará ALL facturas relacionadas con "Apoyo en inspección antinarcóticos" 
// buscando en TODOS los 1639+ registros, NO solo en los primeros 100
```

### 3️⃣ **Buscar por Nombre de Cliente**
```javascript
// ✅ CORRECTO - Búsqueda por nombre de cliente
const response = await fetch('/bill/paginated?search=empresa&page=1&limit=100');
```

### 4️⃣ **Filtros por Rango de Fechas**
```javascript
// ✅ CORRECTO - Filtrar por rango de fechas
const response = await fetch('/bill/paginated?dateStart=2025-01-01&dateEnd=2025-01-31&page=1&limit=100');
```

### 5️⃣ **Combinación de Filtros**
```javascript
// ✅ CORRECTO - Búsqueda + filtros combinados
const response = await fetch('/bill/paginated?search=18401&jobAreaId=1&status=ACTIVE&page=1&limit=100');
```

### 6️⃣ **Obtener Estadísticas Rápidas (NUEVO)**
```javascript
// ✅ NUEVO - Solo contadores, sin datos completos
const stats = await fetch('/bill/search-stats?search=18401');
// Retorna: { totalCount: 150, queryTime: 45, hasLargeDataset: true }
```

## 📊 Estructura de Respuesta

### **Respuesta del Endpoint Principal**
```json
{
  "items": [
    {
      "id": 259,
      "amount": 0,
      "total_bill": "1601439.02",
      "total_paysheet": "725718.45",
      "week_number": 48,
      "status": "ACTIVE",
      "createdAt": "2025-12-06T19:55:40.701Z",
      "operation": {
        "id": 389,
        "client": { "name": "CPS" },
        "area": { "name": "Jurabar" }
      }
    }
  ],
  "pagination": {
    "totalItems": 1639,
    "currentPage": 1,
    "totalPages": 164,
    "itemsPerPage": 100,
    "hasNextPage": true,
    "hasPreviousPage": false,
    "searchApplied": true,        // ✅ NUEVO
    "filtersApplied": true,       // ✅ NUEVO
    "searchTerm": "18401",        // ✅ NUEVO
    "totalRecordsInDatabase": "large-dataset"  // ✅ NUEVO
  }
}
```

## 🔧 Implementación en el Frontend

### **React/JavaScript Example**
```javascript
class BillService {
  async searchBills(filters = {}) {
    const params = new URLSearchParams();
    
    // Agregar parámetros de búsqueda
    if (filters.search) params.set('search', filters.search);
    if (filters.jobAreaId) params.set('jobAreaId', filters.jobAreaId);
    if (filters.status) params.set('status', filters.status);
    if (filters.dateStart) params.set('dateStart', filters.dateStart);
    if (filters.dateEnd) params.set('dateEnd', filters.dateEnd);
    if (filters.page) params.set('page', filters.page);
    if (filters.limit) params.set('limit', filters.limit);

    const response = await fetch(`/bill/paginated?${params}`, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
        'Content-Type': 'application/json'
      }
    });

    return await response.json();
  }
}

// Uso del servicio
const billService = new BillService();

// Buscar por ID de operación
const result = await billService.searchBills({ 
  search: '389', 
  page: 1, 
  limit: 100 
});

// Buscar por código numérico de subtask
const result2 = await billService.searchBills({ 
  search: '18401',  // Código numérico del subtask
  page: 1, 
  limit: 100 
});
```

## ⚠️ Problemas Comunes y Soluciones

### **❌ Error: "No encuentra ID de operación"**
**Causa**: Parámetro de búsqueda no está llegando al backend

**✅ Solución**: Verificar que el parámetro se está enviando correctamente:
```javascript
// ❌ INCORRECTO
const response = await fetch('/bill/paginated');

// ✅ CORRECTO
const response = await fetch('/bill/paginated?search=389');
```

### **❌ Error: "Solo carga 100 registros"**
**Causa**: Límite por defecto del frontend

**✅ Solución**: Ajustar el parámetro limit:
```javascript
// Cargar más registros por página
const response = await fetch('/bill/paginated?limit=500&page=1');
```

### **❌ Error: "Búsqueda solo en primeros resultados"**
**Causa**: Este problema ya fue resuelto ✅

**✅ Solución**: El backend ahora busca en TODOS los 174,828 registros antes de paginar

## 🔍 Debug y Monitoreo

### **Verificar en DevTools**
1. Abrir **Network Tab** en DevTools
2. Buscar la petición a `/bill/paginated`
3. Verificar que los **Query Parameters** incluyen el `search`
4. Revisar la **Response** para confirmar `searchApplied: true`

### **Logs del Backend**
El backend ahora muestra logs detallados:
```
🔍 [Bill Controller] Parámetros recibidos: { search: '389', page: '1' }
🚀 [Bill Service] Búsqueda aplicada a todos los registros
[Bill Pagination] Resultados finales: { totalEncontrados: 12, busqueda: '389' }
```

## 💡 Consejos de Rendimiento

1. **Usar search-stats primero**: Para mostrar contadores rápidos
2. **Paginación inteligente**: Ajustar `limit` según el dataset
3. **Filtros específicos**: Combinar búsqueda con filtros de área/estado de factura
4. **Cache en frontend**: Cachear resultados para navegación rápida

---

## 📝 URLs de Prueba Completas

```
# Buscar operación 389
http://localhost:3000/bill/paginated?search=389&page=1&limit=100

# Buscar por código de subtask (numérico)
http://localhost:3000/bill/paginated?search=18401&page=1&limit=100

# Filtrar por área y estado de la factura
http://localhost:3000/bill/paginated?jobAreaId=1&status=ACTIVE&page=1&limit=100

# Rango de fechas
http://localhost:3000/bill/paginated?dateStart=2025-01-01&dateEnd=2025-01-31&page=1&limit=100

# Estadísticas rápidas
http://localhost:3000/bill/search-stats?search=18401
```

---

## 🚨 **GARANTÍA DE BÚSQUEDA GLOBAL**

### ✅ **CONFIRMADO: La búsqueda funciona en TODOS los registros**

- **ID de Operación**: Busca `389` en **TODOS** los 1639+ registros disponibles
- **Código de Subtask**: Busca `18401` en **TODOS** los registros, no solo en los primeros 500
- **Paginación**: El `limit=500` solo controla cuántos resultados mostrar **POR PÁGINA**
- **Sin limitaciones**: Si una búsqueda encuentra 1000 coincidencias, podrás navegar por todas

### 🔍 **Proceso de Búsqueda:**
1. **Paso 1**: Aplica filtros a TODA la base de datos (1639+ registros)
2. **Paso 2**: Cuenta total de coincidencias (ej: encuentra 50 registros)
3. **Paso 3**: Aplica paginación solo a esas 50 coincidencias
4. **Resultado**: Puedes ver las 50 coincidencias navegando por páginas

**Los logs del servidor confirmarán esto**: 
```
🔍 BÚSQUEDA EN TODOS LOS REGISTROS DISPONIBLES (1639)
✅ De 1639 registros, 50 coinciden con los filtros
📄 Ahora paginar: mostrar 100 por página, página 1
```