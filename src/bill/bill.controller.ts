import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  UseInterceptors,
  NotFoundException,
  ConflictException,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { BillService } from './bill.service';
import { CreateBillDto } from './dto/create-bill.dto';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { SiteInterceptor } from 'src/common/interceptors/site.interceptor';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role, Status } from '@prisma/client';
import { ParseIntPipe } from 'src/pipes/parse-int/parse-int.pipe';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { UpdateBillDto, UpdateBillStatusDto } from './dto/update-bill.dto';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';
import { FilterBillDto } from './dto/filter-bill.dto';
import { ExportBillDto } from './dto/export-bill.dto';
import { ValidationPipe } from '@nestjs/common';
import { ApiProduces } from '@nestjs/swagger';

@Controller('bill')
@UseInterceptors(SiteInterceptor)
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPERVISOR, Role.ADMIN, Role.SUPERADMIN)
@ApiBearerAuth('access-token')
export class BillController {
  constructor(private readonly billService: BillService) {}

  @Post()
  async create(
    @CurrentUser('userId') userId: number,
    @Body() createBillDto: CreateBillDto) {
      // Agrega este console.log para ver lo que llega del frontend
  console.log('=== Datos recibidos para crear factura ==='); 
  console.log(JSON.stringify(createBillDto, null, 2));
  console.log('==========================================');
    const response = await this.billService.create(createBillDto, userId);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    if (response['status'] === 409) {
      throw new ConflictException(response['message']);
    }
    return response;
  }

  @Get()
  @ApiOperation({ 
    summary: 'Obtener Bills con límite opcional',
    description: 'Obtiene Bills con un límite máximo de 20 registros para evitar sobrecarga'
  })
  @ApiQuery({ name: 'limit', required: false, description: 'Límite de registros (máximo 20)', example: 10 })
  async findAll(
    @CurrentUser('id_site') id_site?: number,
    @CurrentUser('id_subsite') id_subsite?: number | null,
    @Query('limit') limit?: number,
  ) {
    // Si se especifica un límite, usar el método limitado
    if (limit) {
      const safeLimit = Math.min(parseInt(limit.toString()) || 20, 20);
      return await this.billService.findAllLimited(safeLimit, id_site, id_subsite);
    }
    
    // Para evitar problemas de conexión, por defecto limitar a 20
    return await this.billService.findAllLimited(20, id_site, id_subsite);
  }

  @Get('limited')
  @ApiOperation({ 
    summary: 'Obtener Bills limitadas (sin pool)',
    description: 'Obtiene un número limitado de Bills para evitar sobrecarga del sistema. Máximo 50 registros.'
  })
  @ApiQuery({ name: 'limit', required: false, description: 'Límite de registros (máximo 50)', example: 20 })
  async findAllLimited(
    @CurrentUser('id_site') id_site?: number,
    @CurrentUser('id_subsite') id_subsite?: number | null,
    @Query('limit') limit?: number,
  ) {
    const safeLimit = Math.min(parseInt(limit?.toString() || '20'), 50);
    return await this.billService.findAllLimited(safeLimit, id_site, id_subsite);
  }

  @Get('paginated')
  @ApiOperation({ 
    summary: 'Obtener Bills paginadas con filtros',
    description: `
    Endpoint optimizado para la paginación de Bills con filtros específicos del frontend.
    
    **Filtros disponibles:**
    - Búsqueda por operación, código o subservicio
    - Filtro por área de trabajo
    - Estado (Activo o Completo)
    - Rango de fechas
    
    **Nota:** Todos los parámetros son opcionales. El userId se obtiene automáticamente del token de autenticación.
    `
  })
  @ApiQuery({ name: 'search', required: false, description: 'Búsqueda por operación, código o subservicio', example: ' ' })
  @ApiQuery({ name: 'jobAreaId', required: false, type: Number, description: 'ID del área de trabajo', example: 1 })
  @ApiQuery({ name: 'status', required: false, enum: ['ACTIVE', 'COMPLETED'], description: 'Estado de la factura', example: 'ACTIVE' })
  @ApiQuery({ name: 'dateStart', required: false, type: String, description: 'Fecha de inicio (YYYY-MM-DD)', example: '2026-03-08' })
  @ApiQuery({ name: 'dateEnd', required: false, type: String, description: 'Fecha de fin (YYYY-MM-DD)', example: '2026-03-14' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Número de página', example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Elementos por página (máximo: 100)', example: 20 })
  @ApiResponse({
    status: 200,
    description: 'Bills obtenidas exitosamente con filtros aplicados',
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Lista de Bills para la página actual'
        },
        pagination: {
          type: 'object',
          properties: {
            totalItems: { type: 'number', example: 150 },
            currentPage: { type: 'number', example: 1 },
            totalPages: { type: 'number', example: 8 },
            itemsPerPage: { type: 'number', example: 20 },
            hasNextPage: { type: 'boolean', example: true },
            hasPreviousPage: { type: 'boolean', example: false }
          }
        }
      }
    }
  })
  async findAllPaginated(
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('subsiteId') subsiteId: number,
    @Query(new ValidationPipe({ transform: true, whitelist: true })) filters: FilterBillDto,
  ) {
    // console.log('🔍 [Bill Controller] Parámetros recibidos:', {
    //   siteId,
    //   subsiteId,
    //   filters,
    //   query_raw: filters
    // });
    
    return await this.billService.findAllPaginatedWithFilters({
      ...filters,
      siteId,
      subsiteId
    });
  }

  @Get('search-stats')
  @ApiOperation({
    summary: 'Obtener estadísticas de búsqueda',
    description: 'Devuelve contadores rápidos para filtros de búsqueda sin cargar los datos completos'
  })
  @ApiResponse({
    status: 200,
    description: 'Estadísticas de búsqueda obtenidas exitosamente',
    schema: {
      type: 'object',
      properties: {
        totalCount: {
          type: 'number',
          description: 'Total de registros que coinciden con los filtros',
          example: 1250
        },
        queryTime: {
          type: 'number',
          description: 'Tiempo en milisegundos que tomó la consulta',
          example: 45
        },
        hasLargeDataset: {
          type: 'boolean',
          description: 'Indica si el conjunto de datos es grande (>1000 registros)',
          example: true
        },
        recommendedPageSize: {
          type: 'number',
          description: 'Tamaño de página recomendado basado en el tamaño del conjunto',
          example: 25
        }
      }
    }
  })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Término de búsqueda' })
  @ApiQuery({ name: 'jobAreaId', required: false, type: Number, description: 'ID del área de trabajo' })
  @ApiQuery({ name: 'status', required: false, enum: Status, description: 'Estado de la factura (ACTIVE, COMPLETED)' })
  @ApiQuery({ name: 'dateStart', required: false, type: String, description: 'Fecha de inicio (YYYY-MM-DD)' })
  @ApiQuery({ name: 'dateEnd', required: false, type: String, description: 'Fecha de fin (YYYY-MM-DD)' })
  async getSearchStats(
    @CurrentUser('id') userId: number,
    @Query('search') search?: string,
    @Query('jobAreaId') jobAreaIdStr?: string,
    @Query('status') status?: Status,
    @Query('dateStart') dateStart?: string,
    @Query('dateEnd') dateEnd?: string,
  ) {
    const jobAreaId = jobAreaIdStr ? parseInt(jobAreaIdStr) : undefined;
    const startDate = dateStart ? new Date(dateStart) : undefined;
    const endDate = dateEnd ? new Date(dateEnd) : undefined;

    return await this.billService.getSearchStats(
      search,
      jobAreaId,
      status,
      startDate,
      endDate,
      userId
    );
  }

  @Get('count')
  @ApiOperation({ 
    summary: 'Contar total de Bills',
    description: 'Obtiene el número total de Bills sin cargar la data'
  })
  async countAll(
    @CurrentUser('id_site') id_site?: number,
    @CurrentUser('id_subsite') id_subsite?: number | null,
  ) {
    const count = await this.billService.countAll(id_site, id_subsite);
    return { totalItems: count };
  }

  @Get(':id')
  @ApiOperation({ 
    summary: 'Obtener un Bill por ID',
    description: `
Obtiene la información detallada de un Bill específico (factura) incluyendo:

**Información retornada:**
- Datos del Bill: id, amount, number_of_workers, totales, week_number, status
- **group_hours**: Duración calculada del grupo desde fechas de Operation_Worker
- **op_duration**: Duración total de la operación (suma de todos los group_hours)
- Distribuciones de horas (facturación y nómina)
- Detalles de trabajadores (billDetails) con sus pagos
- Información de la operación asociada
- Compensatorio calculado automáticamente

**IMPORTANTE:**
- Las fechas del grupo provienen de Operation_Worker, no de Operation
- Cada grupo tiene su propia duración (group_hours) independiente
- group_hours se calcula automáticamente, no se edita manualmente

**Respuesta incluye:**
\`\`\`json
{
  "id": 955,
  "id_operation": 869,
  "id_group": "d1de43a7-cfdd-4950-8238-73374038f927",
  "group_hours": 97.15,  // Calculado desde Operation_Worker
  "op_duration": 194.3,  // Suma de todos los group_hours
  "amount": 0,
  "number_of_workers": 2,
  "total_bill": "0",
  "total_paysheet": "1437376.430",
  "billHoursDistribution": { ... },
  "paysheetHoursDistribution": { ... },
  "compensatory": {
    "hours": 1.22,
    "amount": 150000,
    "percentage": 10.5
  },
  "operation": { ... },
  "billDetails": [
    {
      "id": 1936,
      "operationWorker": {
        "dateStart": "2025-12-19",
        "timeStart": "10:12",
        "dateEnd": "2025-12-23",
        "timeEnd": "11:21",
        "worker": { ... }
      }
    }
  ]
}
\`\`\`
    `
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Bill encontrado exitosamente con toda su información'
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Bill no encontrado con el ID especificado'
  })
  async findOne(
    @Param('id', ParseIntPipe) id: number,
     @CurrentUser('id_site') id_site?: number,
    @CurrentUser('id_subsite') id_subsite?: number | null,

) {
    const bill = await this.billService.findOne(id);
    if (!bill) {
      throw new NotFoundException(`Bill with ID ${id} not found`);
    }
    return bill;
  }

  @Patch(':id')
  @ApiOperation({ 
    summary: 'Actualizar un Bill',
    description: `
Actualiza la información de un Bill específico (factura) de un grupo.

**IMPORTANTE sobre group_hours:**
- El campo 'group_hours' NO se envía en este endpoint
- Se calcula automáticamente desde las fechas de Operation_Worker
- Para actualizar group_hours, debes actualizar las fechas en Operation_Worker:
  1. Actualiza dateStart, timeStart, dateEnd, timeEnd en Operation_Worker
  2. Llama al endpoint POST /bill/recalculate-group-hours
  3. Esto recalculará group_hours y op_duration automáticamente

**¿Qué puedes actualizar aquí?**
- billHoursDistribution: Distribución de horas para facturación
- paysheetHoursDistribution: Distribución de horas para nómina
- amount: Cantidad de unidades/servicios
- observation: Observaciones sobre el bill
- pays: Array de pagos por trabajador

**Ejemplo de uso:**
\`\`\`json
PATCH /bill/955
{
  "id": "d1de43a7-cfdd-4950-8238-73374038f927",
  "observation": "Distribución actualizada",
  "billHoursDistribution": {
    "HOD": 0, "HON": 0, "HED": 2, "HEN": 0,
    "HFOD": 0, "HFON": 0, "HFED": 0, "HFEN": 0
  },
  "pays": [
    { "id_worker": 732, "pay": 1.0 },
    { "id_worker": 606, "pay": 1.0 }
  ]
}
\`\`\`
    `
  })
  @ApiResponse({ status: 200, description: 'Bill actualizado exitosamente' })
  @ApiResponse({ status: 404, description: 'Bill no encontrado' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('userId') userId: number,
    @Body() updateBillDto: UpdateBillDto,
  ) {
   
    
    return this.billService.update(id, updateBillDto, userId);
  }
  
  @Patch(':id/status')
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateBillStatusDto: UpdateBillStatusDto,
    @CurrentUser('userId') userId: number,
  ) {
    const response = await this.billService.updateStatus(
      id, 
      updateBillStatusDto.status, 
      userId
    );
    return response;
  }
@Get('export/excel')
@ApiOperation({
  summary: 'Exportar Bills a Excel',
  description: `
Exporta las Bills (facturas) filtradas a un archivo Excel.

✅ Procesamiento 100% en backend (STREAM)
✅ No usa memoria del cliente
✅ Soporta grandes volúmenes de datos

SIN PAGINACIÓN: descarga todos los registros que coincidan con los filtros
`
})
@ApiQuery({
  name: 'search',
  required: false,
  type: String,
  description: 'Búsqueda general (operación, cliente, código, subservicio)'
})
@ApiQuery({
  name: 'jobAreaIds',
  required: false,
  type: String,
  isArray: true,
  description: 'IDs de áreas de trabajo. Ej: jobAreaIds=27&jobAreaIds=28'
})
@ApiQuery({
  name: 'status',
  required: false,
  enum: ['ACTIVE', 'COMPLETED'],
  description: 'Estado de la factura'
})
@ApiQuery({
  name: 'dateStart',
  required: false,
  type: String,
  description: 'Fecha inicio (YYYY-MM-DD)'
})
@ApiQuery({
  name: 'dateEnd',
  required: false,
  type: String,
  description: 'Fecha fin (YYYY-MM-DD)'
})
@ApiResponse({
  status: 200,
  description: 'Archivo Excel generado correctamente'
})
async exportToExcel(
  @CurrentUser('siteId') siteId: number,
  @CurrentUser('subsiteId') subsiteId: number,
  @Query() query: any,
  @Res() res: Response
) {
  try {
    const normalizedFilters = {
      search: query.search,
      status: query.status,
      dateStart: query.dateStart,
      dateEnd: query.dateEnd,
      jobAreaIds: Array.isArray(query.jobAreaIds)
        ? query.jobAreaIds
        : query.jobAreaIds
          ? [query.jobAreaIds]
          : [],
      siteId,
      subsiteId,
    };

    // console.log('🎯 QUERY CRUDA CONTROLLER:', query);
    // console.log('🎯 FILTROS NORMALIZADOS CONTROLLER:', normalizedFilters);

    const dateRange =
      normalizedFilters.dateStart && normalizedFilters.dateEnd
        ? `_${normalizedFilters.dateStart}_a_${normalizedFilters.dateEnd}`
        : `_${new Date().toISOString().split('T')[0]}`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="reporte_operacion${dateRange}_${new Date().getTime()}.xlsx"`
    );
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Pragma', 'no-cache');

    await this.billService.exportBillsToExcelStream(normalizedFilters, res);
  } catch (error) {
    console.error('❌ Error exportando Excel:', error);

    if (!res.headersSent) {
      res.status(500).json({
        message: 'Error generando Excel',
        error: error?.message || error,
      });
    }
  }
}


  @Post('recalculate-group-hours')
  @ApiOperation({ 
    summary: 'Recalcular group_hours desde fechas de Operation_Worker',
    description: `
**Flujo completo para actualizar fechas de un grupo:**

1. **Actualizar fechas en Operation_Worker:**
\`\`\`json
POST /operation-worker/update-schedule
{
  "id_operation": 869,
  "workersToUpdate": [
    {
      "workerIds": [606, 732],
      "id_group": "d1de43a7-cfdd-4950-8238-73374038f927",
      "dateStart": "2025-12-19",
      "timeStart": "08:00",
      "dateEnd": "2025-12-23",
      "timeEnd": "17:00",
      "id_subtask": 11,
      "id_task": 24,
      "id_tariff": 36
    }
  ]
}
\`\`\`

2. **Llamar a este endpoint** para recalcular automáticamente:
\`\`\`json
POST /bill/recalculate-group-hours
{
  "id_operation": 869,
  "id_group": "d1de43a7-cfdd-4950-8238-73374038f927"
}
\`\`\`

**¿Qué hace automáticamente?**
- Calcula duración de cada trabajador del grupo: (dateEnd + timeEnd) - (dateStart + timeStart)
- Promedia las duraciones → actualiza Bill.group_hours del grupo
- Suma todos los group_hours de la operación → actualiza Operation.op_duration

**Importante:** 
- Las fechas se actualizan en Operation_Worker (no en Operation)
- Cada grupo puede tener fechas diferentes dentro de la misma operación
- Solo afecta al grupo específico, no a otros grupos
    `
  })
  @ApiResponse({ 
    status: 200, 
    description: 'group_hours y op_duration recalculados exitosamente',
    schema: {
      example: {
        groupHours: 97.15,
        opDuration: 194.3,
        message: 'Group hours recalculado exitosamente'
      }
    }
  })
  @ApiResponse({ status: 404, description: 'Grupo u operación no encontrada' })
  async recalculateGroupHours(
    @Body() body: { id_operation: number; id_group: string }
  ) {
    const groupHours = await this.billService.recalculateGroupHoursFromWorkerDates(
      body.id_operation,
      body.id_group
    );
    
    // Obtener el op_duration actualizado
    const operation = await this.billService['prisma'].operation.findUnique({
      where: { id: body.id_operation },
      select: { op_duration: true }
    });
    
    return {
      groupHours,
      opDuration: operation?.op_duration,
      message: 'Group hours recalculado exitosamente'
    };
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.billService.remove(id);
  }



  
}
