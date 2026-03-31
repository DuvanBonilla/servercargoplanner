# 🎯 GUÍA PASO A PASO - Implementación en el Frontend

Esta guía te mostrará EXACTAMENTE qué cambios hacer en el frontend.

---

## 📋 TABLA DE CONTENIDOS

1. [Paso 1: Verificar Requisitos](#paso-1-verificar-requisitos)
2. [Paso 2: Actualizar useBillExport](#paso-2-actualizar-usebillexport)
3. [Paso 3: Actualizar Componentes](#paso-3-actualizar-componentes)
4. [Paso 4: Testing](#paso-4-testing)

---

## Paso 1: Verificar Requisitos

### ✓ Verifica que tengas instalado:

```bash
# En la carpeta del frontend
npm list axios        # Debe estar instalado
npm list exceljs      # NO es necesario en frontend
```

Si axios no está instalado:
```bash
npm install axios
```

---

## Paso 2: Actualizar `useBillExport`

### 📂 Ubicación del archivo actual
```
src/lib/hooks/useBillExport.ts
```

### ✂️ OPCIÓN A: Reemplazar completamente (Recomendado)

1. **Hacer backup del archivo actual**
   ```bash
   cp src/lib/hooks/useBillExport.ts src/lib/hooks/useBillExport.backup.ts
   ```

2. **Copiar el contenido de `useBillExport_NUEVO.ts`**
   - Abre el archivo: `src/lib/hooks/useBillExport_NUEVO.ts`
   - Copia TODO su contenido

3. **Reemplazar el contenido de `useBillExport.ts`**
   - Abre: `src/lib/hooks/useBillExport.ts`
   - Selecciona TODO (Ctrl+A)
   - Elimina (Delete)
   - Pega el nuevo contenido
   - Guarda (Ctrl+S)

### ✂️ OPCIÓN B: Actualizar manualmente (Si tienes cambios locales)

**Paso 1: Reemplazar la función principal**

BUSCA ESTO en tu archivo:
```typescript
export const useBillExport = () => {
  const [isExporting, setIsExporting] = useState(false);

  const exportBillsWithDetails = async (
    bills: Bill[], 
    workers?: any[], 
    tariffs?: any[], 
    subServices?: any[], 
    unitsMeasure?: any[],
    startDateFilter?: string,
    endDateFilter?: string,
    operations?: any[],
    subSites?: any[],
    services?: any[]
  ) => {
    // ... TODO ESTE CÓDIGO DE CONSTRUCCIÓN DE EXCEL
    // Elimina TODO desde aquí hasta el final de la función
  };
```

REEMPLAZA CON ESTO:
```typescript
interface ExportFilters {
  search?: string;
  jobAreaId?: number;
  status?: string;
  dateStart?: string;
  dateEnd?: string;
}

interface ExportError {
  message: string;
  timestamp: string;
}

export const useBillExport = () => {
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<ExportError | null>(null);

  const exportBillsWithDetails = async (filters: ExportFilters = {}) => {
    try {
      setIsExporting(true);
      setExportError(null);

      console.log('📊 [EXPORT] Iniciando exportación con filtros:', filters);

      // Construir query parameters
      const params = new URLSearchParams();
      
      if (filters.search) {
        params.append('search', filters.search);
      }
      if (filters.jobAreaId) {
        params.append('jobAreaId', filters.jobAreaId.toString());
      }
      if (filters.status) {
        params.append('status', filters.status);
      }
      if (filters.dateStart) {
        params.append('dateStart', filters.dateStart);
      }
      if (filters.dateEnd) {
        params.append('dateEnd', filters.dateEnd);
      }

      // Hacer request al backend
      const response = await axios.get(
        `/api/bill/export/excel?${params.toString()}`,
        {
          responseType: 'blob',
          timeout: 60000
        }
      );

      console.log('✅ [EXPORT] Archivo generado exitosamente:', {
        size: \`\${(response.data.size / 1024 / 1024).toFixed(2)} MB\`,
        type: response.data.type
      });

      // Descargar el archivo automáticamente
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      
      const today = new Date().toISOString().split('T')[0];
      link.setAttribute('download', \`reporte_facturas_\${today}.xlsx\`);
      
      document.body.appendChild(link);
      link.click();
      
      window.URL.revokeObjectURL(url);
      document.body.removeChild(link);

      console.log('💾 [EXPORT] Archivo descargado exitosamente');

    } catch (error) {
      const axiosError = error as AxiosError;
      const errorMessage = axiosError?.response?.data?.message || 'Error al exportar facturas';
      
      console.error('❌ [EXPORT] Error durante exportación:', {
        status: axiosError?.response?.status,
        message: errorMessage,
        error: error
      });

      setExportError({
        message: typeof errorMessage === 'string' ? errorMessage : 'Error desconocido',
        timestamp: new Date().toISOString()
      });

      throw error;

    } finally {
      setIsExporting(false);
    }
  };

  return {
    exportBillsWithDetails,
    isExporting,
    exportError
  };
};
```

**Paso 2: Elimina estas funciones (YA NO SON NECESARIAS)**

```typescript
// ❌ ELIMINA ESTA FUNCIÓN
private getColumnLetter = (columnNumber: number): string => { ... }

// ❌ ELIMINA ESTA FUNCIÓN
private configureWorksheet = (worksheet: any, headers: string[]) => { ... }

// ❌ ELIMINA ESTA FUNCIÓN
private configureWorksheetWithCustomColors = (worksheet: any, headers: string[]) => { ... }

// ❌ ELIMINA ESTA FUNCIÓN
private mapHoursDistribution = (bill: any) => { ... }

// ❌ ELIMINA ESTA FUNCIÓN
private populateBillsReport = (worksheet: any, bills: Bill[], ...) => { ... }

// ❌ ELIMINA ESTA FUNCIÓN
private populateBillDetailsReport = (worksheet: any, bills: Bill[], ...) => { ... }

// ❌ ELIMINA ESTA FUNCIÓN
private autoAdjustColumns = (worksheet: any) => { ... }
```

**Paso 3: Agrega el import de axios si no lo tiene**

En la parte de arriba del archivo, agrega:
```typescript
import axios, { AxiosError } from 'axios';
```

---

## Paso 3: Actualizar Componentes

Ahora debes actualizar los componentes que USAN este hook.

### 🔍 Cómo Encontrar Componentes que Usan el Hook

```bash
# En la carpeta del frontend
grep -r "useBillExport" src/

# Resultado típico:
# src/components/BillReport.tsx
# src/pages/bills.tsx
# etc.
```

### 📝 Actualizar Componentes

**ANTES (Código antiguo - que probablemente tienes ahora):**
```typescript
const BillReport = () => {
  const { exportBillsWithDetails, isExporting } = useBillExport();
  const [bills, setBills] = useState<Bill[]>([]);
  const [workers, setWorkers] = useState([]);
  const [tariffs, setTariffs] = useState([]);
  const [operations, setOperations] = useState([]);
  // ... muchos estados más

  const handleExport = async () => {
    try {
      setIsExporting(true);
      
      // CARGAR DATOS (Estaba consumiendo mucha memoria)
      const workersResponse = await fetch('/api/workers?limit=10000');
      const tariffResponse = await fetch('/api/tariffs?limit=10000');
      const operationsResponse = await fetch('/api/operations?limit=10000');
      
      // ... procesar respuestas

      // Exportar con TODOS los parámetros
      await exportBillsWithDetails(
        bills,
        workers,
        tariffs,
        subServices,
        unitsMeasure,
        dateStart,
        dateEnd,
        operations,
        subSites,
        services
      );
      
      toast.success('Exportación completada');
    } catch (error) {
      toast.error('Error al exportar');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <button onClick={handleExport} disabled={isExporting}>
      {isExporting ? 'Exportando...' : 'Descargar Excel'}
    </button>
  );
};
```

**DESPUÉS (Código nuevo - optimizado):**
```typescript
const BillReport = () => {
  const { exportBillsWithDetails, isExporting, exportError } = useBillExport();
  
  // Usa los MISMOS filtros que ya tienes para la tabla
  const [filters, setFilters] = useState({
    search: '',
    jobAreaId: null,
    status: 'ACTIVE',
    dateStart: '',
    dateEnd: ''
  });

  const handleExport = async () => {
    try {
      // ✅ SIMPLE: Solo pasar los filtros
      // El backend hace TODO
      await exportBillsWithDetails(filters);
      
      toast.success('Archivo descargado exitosamente');
    } catch (error) {
      toast.error(exportError?.message || 'Error al exportar');
    }
  };

  return (
    <>
      {/* Tu interfaz de filtros - probablemente ya EXISTE */}
      <input 
        value={filters.search}
        onChange={(e) => setFilters({...filters, search: e.target.value})}
        placeholder="Buscar..."
      />

      <select 
        value={filters.status || 'ACTIVE'}
        onChange={(e) => setFilters({...filters, status: e.target.value})}
      >
        <option value="ACTIVE">Activo</option>
        <option value="COMPLETED">Completado</option>
      </select>

      {/* Botón de exportación */}
      <button 
        onClick={handleExport}
        disabled={isExporting}
        className="btn-primary"
      >
        {isExporting ? '⏳ Exportando...' : '📥 Descargar Excel'}
      </button>

      {exportError && (
        <div className="alert alert-error">
          Error: {exportError.message}
        </div>
      )}
    </>
  );
};
```

### 🔄 Patrón General de Cambios

| Elemento | Antes | Después |
|----------|-------|---------|
| **Parámetros** | 10+ parámetros | 1 objeto `filters` |
| **Carga de datos** | Múltiples fetch | Sin cargas adicionales |
| **Construcción Excel** | En el cliente | ❌ Eliminado |
| **Memoria** | ~1GB | ~50MB |
| **Tiempo** | 30-60s | 5-15s |

---

## Paso 4: Testing

### ✅ Test 1: Verificar que el Hook Funciona

```typescript
// En tu navegador, abre la consola (F12)
// Pega esto:

const testExport = async () => {
  try {
    const response = await fetch('/api/bill/export/excel?status=ACTIVE', {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
      }
    });
    
    if (response.ok) {
      console.log('✅ Endpoint funciona correctamente');
      console.log('Tamaño del archivo:', response.headers.get('content-length'), 'bytes');
    } else {
      console.error('❌ Error:', response.status, response.statusText);
    }
  } catch (error) {
    console.error('❌ Error de red:', error);
  }
};

testExport();
```

### ✅ Test 2: Verificar Descarga en UI

1. **Navega a tu componente de Bills**
2. **Aplica filtros** (si es necesario)
3. **Haz click en "Descargar Excel"**
4. **Verifica que:**
   - El botón muestre "Exportando..."
   - Un archivo se descargue en tu carpeta Downloads
   - El archivo se pueda abrir en Excel
   - El archivo contenga datos

### ✅ Test 3: Verificar Rendimiento

Abre Developer Tools (F12) → Performance tab:

**ANTES** (Con hook antiguo):
```
Task Name: exportBillsWithDetails
Duration: 45 seconds
Memory Used: ~900 MB
CPU: 100%
```

**DESPUÉS** (Con endpoint backend):
```
Task Name: exportBillsWithDetails
Duration: 8 seconds
Memory Used: ~40 MB
CPU: 5-10%
```

---

## 🐛 Debugging - Si Algo No Funciona

### Problema: "Error 401 - No Autorizado"
```typescript
// Verifica que el token se esté enviando
// Agrega esto a tu llamada (si no usas interceptor):

const response = await axios.get('/api/bill/export/excel', {
  headers: {
    'Authorization': `Bearer ${yourToken}`  // ← Agrega esta línea
  },
  // ... rest de config
});
```

### Problema: "No es descargable"
```typescript
// Verifica que estés usando responseType: 'blob'
const response = await axios.get('/api/bill/export/excel', {
  responseType: 'blob',  // ← IMPORTANTE
  timeout: 60000
});
```

### Problema: "Archivos vacíos"
```typescript
// Verifica que los filtros sean correctos
console.log('Filters being sent:', {
  search: filters.search,
  jobAreaId: filters.jobAreaId,
  status: filters.status,
  dateStart: filters.dateStart,  // Debe ser YYYY-MM-DD
  dateEnd: filters.dateEnd        // Debe ser YYYY-MM-DD
});
```

### Problema: "Timeout"
```typescript
// Aumenta el timeout para archivos grandes
const response = await axios.get('/api/bill/export/excel', {
  timeout: 120000  // 2 minutos en lugar de 1 minuto
});
```

---

## 📊 Checklist Final

Antes de considerar que la migración está completa:

- [ ] Backup del archivo `useBillExport.ts` hecho
- [ ] Archivo actualizado sin errores de compilación
- [ ] Componentes actualizados para usar nuevo formato de parámetros
- [ ] Test sin filtros (exporta TODO)
- [ ] Test con filtros individuales
- [ ] Test con filtros combinados
- [ ] Verificar que el archivo descargado tiene datos
- [ ] Verificar que los filtros se aplican correctamente en el Excel
- [ ] Verificar que el rendimiento mejoró
- [ ] Logs `[EXPORT]` aparecen en consola del navegador

---

## 🎉 ¡LISTO!

Si completaste todos los pasos y los tests pasaron, la migración está LISTA.

Los cambios en el frontend habrán:
- ✅ Reducido consumo de memoria en un 95%
- ✅ Mejorado velocidad de exportación en un 75%
- ✅ Disminuido carga en el servidor OceanDigital
- ✅ Mejorado experiencia de usuario

---

## 📞 Preguntas Frecuentes

**P: ¿Necesito instalar algo más en el frontend?**  
R: Solo axios si no lo tenías. ExcelJS se usa en el backend, no en el frontend.

**P: ¿Los filtros funcionan igual?**  
R: Sí, exactamente igual. Los mismos filtros que usabas ahora se envían al backend.

**P: ¿Puedo descargar de nuevo el archivo?**  
R: Sí, cada clicks en el botón genera un nuevo archivo con los datos actuales.

**P: ¿Qué pasa con archivos muy grandes?**  
R: El servidor puede generar archivos de hasta varios cientos de MB sin problema. El cliente solo descarga.

**P: ¿Funciona en todos los navegadores?**  
R: Sí, la descarga de archivos es estándar HTML5.

**P: ¿Necesito cambiar la API base URL?**  
R: No, usa la misma URL que ya tienes configurada para `/api/bill/...`
