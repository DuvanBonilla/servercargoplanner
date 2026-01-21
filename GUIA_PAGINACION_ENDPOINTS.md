# Documentación de Endpoints de Paginación

## 📋 Operaciones (`/operation/paginated`)

### Endpoint
```
GET /operation/paginated
```

### Autenticación
Requiere token JWT en el header: `Authorization: Bearer {token}`

### Parámetros de Consulta

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `page` | number | No | 1 | Número de página |
| `limit` | number | No | 10 | Elementos por página (máx: 500) |
| `status` | StatusOperation[] | No | - | Estado(s) de operaciones: PENDING, INPROGRESS, FINALIZED, CANCELLED |
| `dateStart` | Date | No | - | Fecha de inicio mínima (YYYY-MM-DD) |
| `dateEnd` | Date | No | - | Fecha de fin máxima (YYYY-MM-DD) |
| `jobAreaId` | number | No | - | ID del área de trabajo |
| `userId` | number | No | - | ID del usuario |
| `inChargedId` | number | No | - | ID del usuario encargado |
| `search` | string | No | - | Búsqueda de texto |
| `activatePaginated` | boolean | No | true | Activar/desactivar paginación |

### Ejemplos de Uso

#### 1. Paginación básica
```javascript
// Página 1, 10 elementos por página
fetch('http://192.168.15.83:5174/operation/paginated?page=1&limit=10', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
})
```

#### 2. Filtrar por estado
```javascript
// Operaciones PENDIENTES o EN PROGRESO
fetch('http://192.168.15.83:5174/operation/paginated?page=1&limit=20&status=PENDING,INPROGRESS', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
})
```

#### 3. Filtrar por rango de fechas
```javascript
// Operaciones de enero 2026
fetch('http://192.168.15.83:5174/operation/paginated?page=1&limit=50&dateStart=2026-01-01&dateEnd=2026-01-31', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
})
```

#### 4. Filtrar por área de trabajo
```javascript
// Operaciones del área 5
fetch('http://192.168.15.83:5174/operation/paginated?page=1&limit=30&jobAreaId=5', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
})
```

#### 5. Búsqueda de texto
```javascript
// Buscar "proyecto" en las operaciones
fetch('http://192.168.15.83:5174/operation/paginated?page=1&limit=20&search=proyecto', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
})
```

#### 6. Filtros combinados
```javascript
// Operaciones finalizadas del área 5 en enero 2026
fetch('http://192.168.15.83:5174/operation/paginated?page=1&limit=50&status=FINALIZED&jobAreaId=5&dateStart=2026-01-01&dateEnd=2026-01-31', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
})
```

### Respuesta

```json
{
  "items": [
    {
      "id": 1734,
      "status": "FINALIZED",
      "dateStart": "2026-01-19T00:00:00.000Z",
      "dateEnd": "2026-01-19T00:00:00.000Z",
      "timeStrat": "08:00",
      "timeEnd": "17:00",
      "motorShip": "Cargue de bongo o de cont. sobre barcaza",
      "zone": 4,
      "id_user": 28,
      "id_area": 2,
      "id_task": 1,
      "id_client": 1,
      "createAt": "2025-03-24T00:00:00.000Z",
      "updateAt": "2025-03-25T00:00:00.000Z",
      "id_site": 2,
      "id_subsite": null,
      "client": {
        "id": 1,
        "name": "Muelle 2"
      },
      "user": {
        "id": 28,
        "name": "Cesar Augusto Ramirez Marin"
      },
      "jobArea": {
        "id": 2,
        "name": "CAJAS"
      },
      "task": {
        "id": 1,
        "name": "Ingreso y salida de oficina"
      }
    }
  ],
  "pagination": {
    "totalItems": 156,
    "itemsPerPage": 10,
    "currentPage": 1,
    "totalPages": 16,
    "hasNextPage": true,
    "hasPreviousPage": false
  },
  "nextPages": []
}
```

---

## 📋 Faltas (`/called-attention/paginated`)

### Endpoint
```
GET /called-attention/paginated
```

### Parámetros de Consulta

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `page` | number | No | 1 | Número de página |
| `limit` | number | No | 10 | Elementos por página |
| `type` | Failures | No | - | Tipo de falta: INASSISTANCE, DELAY, IRRESPECTFUL |
| `startDate` | Date | No | - | Fecha de inicio (YYYY-MM-DD) |
| `endDate` | Date | No | - | Fecha de fin (YYYY-MM-DD) |
| `search` | string | No | - | Búsqueda por DNI o nombre |
| `activatePaginated` | boolean | No | true | Activar/desactivar paginación |

### Ejemplos de Uso

```javascript
// Faltas por inasistencia
fetch('http://192.168.15.83:5174/called-attention/paginated?page=1&limit=20&type=INASSISTANCE', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
})

// Buscar por DNI
fetch('http://192.168.15.83:5174/called-attention/paginated?page=1&limit=10&search=1082865871', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
})
```

---

## 📋 Alimentación (`/feeding/paginated`)

### Endpoint
```
GET /feeding/paginated
```

### Parámetros de Consulta

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `page` | number | No | 1 | Número de página |
| `limit` | number | No | 10 | Elementos por página |
| `type` | FeedingStatus | No | - | Tipo de alimentación |
| `startDate` | Date | No | - | Fecha de inicio (YYYY-MM-DD) |
| `endDate` | Date | No | - | Fecha de fin (YYYY-MM-DD) |
| `search` | string | No | - | Búsqueda por DNI o nombre |
| `activatePaginated` | boolean | No | true | Activar/desactivar paginación |

### Ejemplos de Uso

```javascript
// Alimentaciones de enero 2026
fetch('http://192.168.15.83:5174/feeding/paginated?page=1&limit=50&startDate=2026-01-01&endDate=2026-01-31', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
})
```

---

## 📋 Facturas (`/bill/paginated`)

### Endpoint
```
GET /bill/paginated
```

### Parámetros de Consulta

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `page` | number | No | 1 | Número de página |
| `limit` | number | No | 10 | Elementos por página |
| `startDate` | Date | No | - | Fecha de inicio (YYYY-MM-DD) |
| `endDate` | Date | No | - | Fecha de fin (YYYY-MM-DD) |
| `search` | string | No | - | Búsqueda por ID de operación |
| `activatePaginated` | boolean | No | true | Activar/desactivar paginación |

---

## 🎯 Notas Importantes

### Filtro por Sitio
Todos los endpoints **automáticamente filtran** los datos según el `id_site` del usuario autenticado. El usuario solo verá los datos de su sitio.

### Rendimiento
- Para datasets grandes (>1000 registros), se recomienda usar `limit=100` o menos
- Use filtros para reducir el conjunto de datos
- El backend ajusta automáticamente los límites para optimizar el rendimiento

### Estados de Operación
- `PENDING`: Pendiente
- `INPROGRESS`: En progreso
- `FINALIZED`: Finalizada
- `CANCELLED`: Cancelada

### Tipos de Falta
- `INASSISTANCE`: Inasistencia
- `DELAY`: Retraso
- `IRRESPECTFUL`: Irrespetuoso

---

## 🔧 Ejemplo Completo con React/Vue

```javascript
// Función para obtener operaciones paginadas
async function fetchOperations(page = 1, filters = {}) {
  const params = new URLSearchParams({
    page: page.toString(),
    limit: '20',
    ...filters
  });

  try {
    const response = await fetch(`/operation/paginated?${params}`, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error('Error al obtener operaciones');
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}

// Uso
const result = await fetchOperations(1, {
  status: 'PENDING,INPROGRESS',
  jobAreaId: '5',
  dateStart: '2026-01-01',
  dateEnd: '2026-01-31'
});

console.log('Items:', result.items);
console.log('Total:', result.pagination.totalItems);
console.log('Páginas:', result.pagination.totalPages);
```
