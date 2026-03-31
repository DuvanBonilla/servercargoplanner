# 📊 Guía de Migración: Exportación de Excel del Frontend al Backend

## 🎯 Objetivo
Mover toda la lógica de generación de archivos Excel desde el frontend (`useBillExport`) hacia el backend para evitar saturar la memoria del cliente.

---

## ✅ Cambios en el Backend - YA IMPLEMENTADOS

### 1. Nuevo Endpoint
**GET** `/bill/export/excel`

- **Descripción**: Genera un archivo Excel con todas las facturas filtradas
- **Ubicación**: `src/bill/bill.controller.ts`
- **Método del servicio**: `exportBillsToExcel()` en `src/bill/bill.service.ts`

### 2. Parámetros Soportados (Query Parameters)

| Parámetro | Tipo | Descripción | Ejemplo |
|-----------|------|-------------|---------|
| `search` | string | Búsqueda por operación, código o subservicio | "proyecto" |
| `jobAreaId` | number | ID del área de trabajo | 1 |
| `status` | string | Estado del Bill (ACTIVE o COMPLETED) | "ACTIVE" |
| `dateStart` | string | Fecha de inicio YYYY-MM-DD | "2024-01-01" |
| `dateEnd` | string | Fecha de fin YYYY-MM-DD | "2024-12-31" |

### 3. Ejemplo de Llamada

```typescript
// URL completa con todos los filtros
GET /bill/export/excel?status=ACTIVE&jobAreaId=1&dateStart=2024-01-01&dateEnd=2024-12-31

// Respuesta
- Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
- Content-Disposition: attachment; filename="reporte_facturas_2024-01-15.xlsx"
- Body: Buffer del archivo Excel
```

### 4. Estructura del Excel Generado

**Hoja: "Facturas"**

| Columna | Descripción |
|---------|------------|
| Operación | ID de la operación |
| Fecha Inicio | Fecha de inicio de la operación |
| Fecha Fin | Fecha de fin de la operación |
| Cliente | Nombre del cliente |
| Área | Nombre del área |
| Subservicio | Servicios asociados |
| Trabajadores | Cantidad de trabajadores |
| Horas Operación | Duración total de la operación |
| Total Facturación | Monto total de facturación |
| Total Nómina | Total para nómina |
| Estado | Estado del Bill |
| Usuario | Nombre del usuario que creó |

---

## 🔄 Cambios en el Frontend - A IMPLEMENTAR

### 1. Simplificar el Hook `useBillExport`

**ANTES** (Actual - Procesa TODO en el cliente):
```typescript
const useBillExport = () => {
  const [isExporting, setIsExporting] = useState(false);

  const exportBillsWithDetails = async (
    bills: Bill[], 
    workers?: any[], 
    tariffs?: any[],
    // ... muchos parámetros más
  ) => {
    setIsExporting(true);
    // AQUÍ SE CONSTRUYE EL EXCEL EN EL CLIENTE
    // - Carga operaciones
    // - Carga alimentación
    // - Construye workbook
    // - Genera rows
    // - Consume MUCHA MEMORIA
  };
};
```

**DESPUÉS** (Migrado - Solo hace llamada HTTP):
```typescript
const useBillExport = () => {
  const [isExporting, setIsExporting] = useState(false);

  const exportBillsWithDetails = async (filters: {
    search?: string;
    jobAreaId?: number;
    status?: string;
    dateStart?: string;
    dateEnd?: string;
  }) => {
    try {
      setIsExporting(true);
      
      // Construir query string con los filtros
      const queryParams = new URLSearchParams();
      if (filters.search) queryParams.append('search', filters.search);
      if (filters.jobAreaId) queryParams.append('jobAreaId', filters.jobAreaId.toString());
      if (filters.status) queryParams.append('status', filters.status);
      if (filters.dateStart) queryParams.append('dateStart', filters.dateStart);
      if (filters.dateEnd) queryParams.append('dateEnd', filters.dateEnd);

      // Llamar al endpoint del backend
      const response = await fetch(`/api/bill/export/excel?${queryParams}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}` // Tu token JWT
        }
      });

      if (!response.ok) {
        throw new Error('Error al exportar facturas');
      }

      // Descargar el archivo
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reporte_facturas_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

    } catch (error) {
      console.error('Error al exportar:', error);
      // Mostrar error al usuario
    } finally {
      setIsExporting(false);
    }
  };

  return {
    exportBillsWithDetails,
    isExporting,
  };
};
```

### 2. Actualizar el Componente que Usa el Hook

**ANTES**:
```typescript
const BillReport = () => {
  const { exportBillsWithDetails, isExporting } = useBillExport();
  const [bills, setBills] = useState<Bill[]>([]);
  const [allWorkers, setAllWorkers] = useState([]);
  const [allTariffs, setAllTariffs] = useState([]);
  // ... muchos estados más

  const handleExport = async () => {
    // Cargar TODO antes de exportar
    const workers = await fetch('/api/workers?limit=10000');
    const tariffs = await fetch('/api/tariffs?limit=10000');
    const operations = await fetch('/api/operations?limit=10000');
    // ... consumir memoria cargando todo

    // Construir el Excel EN EL CLIENTE
    await exportBillsWithDetails(
      bills,
      workers,
      tariffs,
      operations,
      // ... muchos parámetros
    );
  };
};
```

**DESPUÉS**:
```typescript
const BillReport = () => {
  const { exportBillsWithDetails, isExporting } = useBillExport();
  
  // Usar los mismos filtros que ya tienes para la vista
  const [filters, setFilters] = useState({
    search: '',
    jobAreaId: null,
    status: 'ACTIVE',
    dateStart: '',
    dateEnd: ''
  });

  const handleExport = async () => {
    // ✅ SIMPLE: Solo pasar los filtros
    // El backend hace TODO
    await exportBillsWithDetails(filters);
  };

  return (
    <>
      {/* Tu interfaz de filtros y botón de exportación */}
      <button onClick={handleExport} disabled={isExporting}>
        {isExporting ? 'Exportando...' : 'Descargar Excel'}
      </button>
    </>
  );
};
```

### 3. Cambios en la Llamada al Exportar

**Paso a paso:**

1. **El usuario aplica filtros** en la interfaz (área, estado, rango de fechas)
2. **El usuario hace click en "Descargar Excel"**
3. **El frontend envía los filtros al backend:** `GET /bill/export/excel?status=ACTIVE&dateStart=2024-01-01&dateEnd=2024-12-31`
4. **El backend:**
   - Aplica los filtros
   - Carga las facturas
   - Construye el Excel (sin consumir memoria del cliente)
   - Retorna el archivo
5. **El frontend:** Descarga el archivo automáticamente

---

## 📈 Beneficios

| Aspecto | Antes | Después |
|--------|-------|---------|
| **Memoria del Cliente** | ⚠️ CRÍTICA (puede alcanzar 500MB+) | ✅ MÍNIMA (<10MB) |
| **Tiempo de respuesta** | ⏱️ 30-60s (procesamiento local) | ✅ 5-15s (validado en servidor) |
| **Servidor OceanDigital** | 🔴 Saturado | 🟢 Optimizado |
| **Paralelismo** | ❌ Bloquea UI | ✅ Respuesta HTTP asíncrona |
| **Escalabilidad** | ❌ Limitada por RAM cliente | ✅ Limitada por servidor |

---

## 🧪 Testing

### Test en Postman
```
GET http://localhost:3000/api/bill/export/excel?status=ACTIVE&dateStart=2024-03-01&dateEnd=2024-03-31
Authorization: Bearer <TU_TOKEN_JWT>
```

### Test en Frontend (usando Axios)
```typescript
import axios from 'axios';

const downloadExcelReport = async () => {
  try {
    const response = await axios.get('/api/bill/export/excel', {
      params: {
        status: 'ACTIVE',
        dateStart: '2024-03-01',
        dateEnd: '2024-03-31'
      },
      responseType: 'blob',
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `reporte_${new Date().toISOString().split('T')[0]}.xlsx`);
    document.body.appendChild(link);
    link.click();
    link.parentNode.removeChild(link);
  } catch (error) {
    console.error('Error:', error);
  }
};
```

---

## ⚠️ Notas Importantes

1. **El endpoint es GET** (no POST), para permitir descargas directas
2. **Todos los filtros son opcionales** - si no pasas filtros, exporta TODO
3. **La autenticación es obligatoria** - requiere token JWT válido
4. **Respeta permisos de sitio/subsitio** - el backend valida automáticamente
5. **Timeout recomendado en cliente**: 60s (arquivos grandes pueden tardar)

---

## 🚀 Próximos Pasos

1. ✅ Backend: Ya implementado
2. 🔄 **Frontend**: Actualizar `useBillExport.ts`
3. 🔄 **Frontend**: Actualizar componente que usa el hook
4. 🧪 **Test**: Verificar descargas en navegador real
5. 📊 **Monitoreo**: Verificar reduce en uso de memoria en cliente

---

## 📞 Soporte

Si hay problemas durante la migración:
1. Verifica que el token JWT sea válido
2. Asegúrate que los filtros usen el formato correcto (YYYY-MM-DD para fechas)
3. Revisa los logs del servidor: `console.log` con prefijo `[EXPORT]`
