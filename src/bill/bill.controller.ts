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
} from '@nestjs/common';
import { BillService } from './bill.service';
import { CreateBillDto } from './dto/create-bill.dto';
import { ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { SiteInterceptor } from 'src/common/interceptors/site.interceptor';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { ParseIntPipe } from 'src/pipes/parse-int/parse-int.pipe';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { UpdateBillDto, UpdateBillStatusDto } from './dto/update-bill.dto';

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
  
  async findAll(
  @CurrentUser('id_site') id_site?: number,
    @CurrentUser('id_subsite') id_subsite?: number | null,

  ) {
    const bills = await this.billService.findAll(id_site, id_subsite);
    return bills;
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
