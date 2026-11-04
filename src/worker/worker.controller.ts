import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ConflictException,
  NotFoundException,
  UseGuards,
  UsePipes,
  Res,
  Query,
  UseInterceptors,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { WorkerService } from './worker.service';
import { Response } from 'express';
import { CreateWorkerDto } from './dto/create-worker.dto';
import { UpdateWorkerDto } from './dto/update-worker.dto';
import { ParseIntPipe } from 'src/pipes/parse-int/parse-int.pipe';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DateTransformPipe } from 'src/pipes/date-transform/date-transform.pipe';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
// import { ExcelExportService } from 'src/common/validation/services/excel-export.service';
import { SiteInterceptor } from 'src/common/interceptors/site.interceptor';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ContractType, Role } from '@prisma/client';
import { WorkerContractService } from 'src/worker-contract/worker-contract.service';
import { WorkerContractBodyDto } from 'src/worker-contract/dto/create-worker-contract.dto';
import { UpdateWorkerContractDto } from 'src/worker-contract/dto/update-worker-contract.dto';
import { RenewWorkerContractDto } from 'src/worker-contract/dto/renew-worker-contract.dto';
import {
  ContractEndDateEntity,
  ExpiringContractEntity,
  WorkerContractEntity,
} from 'src/worker-contract/entities/worker-contract.entity';
/**
 * @category Controller
 */
@Controller('worker')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(SiteInterceptor)
@ApiBearerAuth('access-token')
export class WorkerController {
  private recentRequests = new Map<string, { timestamp: number; processing: boolean }>();
  private readonly DUPLICATE_WINDOW_MS = 5000; // 5 segundos para considerar duplicado

  constructor(
    private readonly workerService: WorkerService,
    // private readonly excelExportService: ExcelExportService,
    private readonly workerContractService: WorkerContractService,
  ) {}

  /**
   * Errores de contrato al crear/reactivar un trabajador: se lanzan como HTTP
   * real. El resto de respuestas { status, message } se devuelven como antes.
   */
  private handleContractSource(response: any) {
    return response?.source === 'contract' ? this.handleContract(response) : response;
  }

  /** Convierte las respuestas { status, message } del servicio de contratos en excepciones HTTP */
  private handleContract(response: any) {
    switch (response?.status) {
      case 400:
        throw new BadRequestException(response.message);
      case 403:
        throw new ForbiddenException(response.message);
      case 404:
        throw new NotFoundException(response.message);
      case 409:
        throw new ConflictException(response.message);
    }
    return response;
  }

 @Post()
async create(
  @Body() createWorkerDto: CreateWorkerDto,
  @CurrentUser('userId') userId: number,
  @CurrentUser('siteId') siteId: number,
  @CurrentUser('subsiteId') subsiteId: number,
  @CurrentUser('role') role: string,
) {
    const requestId = Math.random().toString(36).substring(7);
    // console.log(`[WorkerController] 🚀 ${requestId} - POST /worker initiated`);
    // console.log(`[WorkerController] ${requestId} - createWorkerDto:`, createWorkerDto);
    // console.log(`[WorkerController] ${requestId} - userId: ${userId}, siteId: ${siteId}, subsiteId: ${subsiteId}`);
    
    // Crear clave única para detectar peticiones duplicadas
    const requestKey = `${userId}-${createWorkerDto.dni}-${createWorkerDto.code}-${createWorkerDto.payroll_code}`;
    const now = Date.now();
    
    // Limpiar peticiones antiguas
    for (const [key, value] of this.recentRequests.entries()) {
      if (now - value.timestamp > this.DUPLICATE_WINDOW_MS) {
        this.recentRequests.delete(key);
      }
    }
    
    // Verificar si es una petición duplicada
    const existingRequest = this.recentRequests.get(requestKey);
    if (existingRequest) {
      if (existingRequest.processing) {
        // console.log(`[WorkerController] ${requestId} - ⚠️ PETICIÓN DUPLICADA DETECTADA (procesando), rechazando...`);
        throw new ConflictException('Duplicate request detected - already processing');
      } else {
        // console.log(`[WorkerController] ${requestId} - ⚠️ PETICIÓN DUPLICADA DETECTADA (reciente), rechazando...`);
        throw new ConflictException('Duplicate request detected - request processed recently');
      }
    }
    
    // Marcar petición como en proceso
    this.recentRequests.set(requestKey, { timestamp: now, processing: true });
    
    try {
      // Agrega el log aquí
      // console.log('subsiteId recibido:', subsiteId);
      createWorkerDto.id_user = userId;

    if (typeof createWorkerDto.id_site === 'undefined' || createWorkerDto.id_site === null) {
      createWorkerDto.id_site = siteId;
    }
    if (typeof createWorkerDto.id_subsite === 'undefined' || createWorkerDto.id_subsite === null) {
      createWorkerDto.id_subsite = subsiteId;
    }

      console.log(`[WorkerController] ${requestId} - Calling workerService.create...`);
      const result = this.handleContractSource(
        await this.workerService.create(createWorkerDto, siteId, role, userId),
      );
      console.log(`[WorkerController] ${requestId} - ✅ Service call completed successfully`);
      
      // Marcar como completado (no en proceso)
      this.recentRequests.set(requestKey, { timestamp: now, processing: false });
      
      return result;
    } catch (error) {
      // En caso de error, remover la petición para permitir reintentos
      this.recentRequests.delete(requestKey);
      console.log(`[WorkerController] ${requestId} - ❌ Error occurred, removed from recent requests`);
      throw error;
    }
}
  @Get()
  @ApiQuery({
    name: 'format',
    required: false,
    enum: ['json', 'excel', 'base64'],
    description:
      'Formato de respuesta: json por defecto o excel para exportación',
  })
  @Get()
  @ApiOperation({ summary: 'Obtener todos los trabajadores' })
  @ApiQuery({
    name: 'globalSearch',
    required: false,
    type: Boolean,
    description:
      'Si es true, obtiene todos los trabajadores sin filtrar por sede (para mostrar nombres)',
  })
  async findAll(
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('subsiteId') subsiteId: number,
    @Query('globalSearch') globalSearch?: boolean,
  ) {
    return this.workerService.findAll(
      globalSearch ? undefined : siteId,
      globalSearch ? undefined : subsiteId,
      // globalSearch || false
    );
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Resumen de trabajadores para el dashboard',
    description:
      'Conteo de trabajadores por estado (AVALIABLE/ASSIGNED/DISABLE/PERMISSION/...) calculado en base de datos, ' +
      'sin traer el listado completo de trabajadores. Pensado para alimentar las tarjetas y gráficas del dashboard.',
  })
  async getSummary(@CurrentUser('siteId') siteId: number) {
    return this.workerService.getSummary(siteId);
  }

  // ─── Contratos del trabajador (lógica en src/worker-contract) ───

  @Get('contracts/end-date')
  @ApiTags('Worker contracts')
  @ApiOperation({
    summary: 'Calculate contract end date',
    description:
      'Returns the termination date for a contractType so the user can confirm it before registering the contract. ' +
      'A fixed-term contract that reaches its stipulated expiry is renewed automatically, so the termination date is set before it: ' +
      'FIXED_13_WEEKS = start + 13 weeks - 1 day - 2 days, FIXED_3_MONTHS = start + 3 months - 1 day - 1 day, ' +
      'FIXED_1_YEAR = start + 1 year - 1 day - 2 days, ' +
      'OBRA_LABOR = `stipulatedEndDate` - 2 days (maximum 1 year), APPRENTICESHIP = start + `months` (6 by default, up to 12) - 1 day. ' +
      'INDEFINITE has no end date.',
  })
  @ApiQuery({ name: 'contractType', required: true, enum: ContractType })
  @ApiQuery({ name: 'startDate', required: true, type: String, example: '2026-07-01', description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'months', required: false, type: Number, example: 6, description: 'APPRENTICESHIP only: 6 to 12' })
  @ApiQuery({ name: 'stipulatedEndDate', required: false, type: String, example: '2026-12-15', description: 'OBRA_LABOR only: stipulated expiry of the work (YYYY-MM-DD)' })
  @ApiResponse({ status: 200, description: 'Calculated termination date and limits', type: ContractEndDateEntity })
  @ApiResponse({ status: 400, description: 'Invalid contractType, startDate, months or stipulatedEndDate, or the termination exceeds the maximum' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  calculateContractEndDate(
    @Query('contractType') contractType: ContractType,
    @Query('startDate') startDate: string,
    @Query('months') months?: string,
    @Query('stipulatedEndDate') stipulatedEnd?: string,
  ) {
    if (!Object.values(ContractType).includes(contractType)) {
      throw new BadRequestException(`contractType must be one of the following: ${Object.values(ContractType).join(', ')}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate ?? '')) {
      throw new BadRequestException('startDate must have the format YYYY-MM-DD');
    }
    const parsedMonths = months === undefined ? undefined : Number(months);
    if (parsedMonths !== undefined && !Number.isInteger(parsedMonths)) {
      throw new BadRequestException('months must be an integer');
    }
    if (stipulatedEnd !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(stipulatedEnd)) {
      throw new BadRequestException('stipulatedEndDate must have the format YYYY-MM-DD');
    }
    return this.handleContract(
      this.workerContractService.getEndDateSuggestion(contractType, startDate, parsedMonths, stipulatedEnd),
    );
  }

  @Get('contracts/expiring')
  @ApiTags('Worker contracts')
  @ApiOperation({
    summary: 'List expiring contracts',
    description:
      'Contracts whose worker is not DEACTIVATED and has no later contract, with a termination date within the next `days` days ' +
      '(30 by default) or already passed. Nothing is deactivated automatically.',
  })
  @ApiQuery({ name: 'days', required: false, type: Number, example: 30, description: 'Days ahead to look (default 30)' })
  @ApiResponse({ status: 200, description: 'Expiring contracts ordered by endDate', type: [ExpiringContractEntity] })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  async findExpiringContracts(
    @Query('days') days: string,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
  ) {
    const parsed = days === undefined ? undefined : Number(days);
    if (parsed !== undefined && (!Number.isInteger(parsed) || parsed < 0)) {
      throw new BadRequestException('days must be a non-negative integer');
    }
    return this.workerContractService.findExpiring(parsed, siteId, role);
  }

  @Post(':id/contracts')
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH)
  @ApiTags('Worker contracts')
  @ApiOperation({
    summary: 'Create worker contract',
    description:
      'Registers a contract of the worker with a company. endDate is the termination date (see GET /worker/contracts/end-date); ' +
      'if omitted, the calculated one is used (FIXED_13_WEEKS, FIXED_3_MONTHS, APPRENTICESHIP). ' +
      'OBRA_LABOR requires endDate (maximum 1 year) and INDEFINITE does not accept it. It cannot overlap another contract of the same worker: close the current one first by setting its endDate. ' +
      'It never reactivates the worker: a DEACTIVATED worker only accepts finished contracts (endDate before today and not after its retirement date). ' +
      'The dateRetierment of the worker is synced with the endDate of the latest contract. Roles: SUPERADMIN, ADMIN, GH.',
  })
  @ApiParam({ name: 'id', type: Number, example: 128, description: 'Worker id' })
  @ApiResponse({ status: 201, description: 'Contract created', type: WorkerContractEntity })
  @ApiResponse({ status: 400, description: 'Invalid data, startDate after endDate or company not ACTIVE' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'User role is not allowed or worker belongs to another site' })
  @ApiResponse({ status: 404, description: 'Worker or company not found' })
  @ApiResponse({ status: 409, description: 'Overlaps another contract or worker is DEACTIVATED and the contract is not finished' })
  async createContract(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: WorkerContractBodyDto,
    @CurrentUser('userId') userId: number,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
  ) {
    return this.handleContract(
      await this.workerContractService.create({ ...dto, id_worker: id, id_user: userId }, siteId, role),
    );
  }

  @Get(':id/contracts')
  @ApiTags('Worker contracts')
  @ApiOperation({
    summary: 'List contracts of a worker',
    description: 'Contract history of the worker, most recent first, including company and its current ARL.',
  })
  @ApiParam({ name: 'id', type: Number, example: 128, description: 'Worker id' })
  @ApiResponse({ status: 200, description: 'Contract history', type: [WorkerContractEntity] })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'Worker belongs to another site' })
  @ApiResponse({ status: 404, description: 'Worker not found' })
  async findContracts(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
  ) {
    return this.handleContract(await this.workerContractService.findByWorker(id, siteId, role));
  }

  @Get(':id/contracts/current')
  @ApiTags('Worker contracts')
  @ApiOperation({
    summary: 'Get contract in effect',
    description: 'Contract of the worker in effect on `date` (default: today in Colombia).',
  })
  @ApiParam({ name: 'id', type: Number, example: 128, description: 'Worker id' })
  @ApiQuery({ name: 'date', required: false, type: String, example: '2026-10-26', description: 'YYYY-MM-DD' })
  @ApiResponse({ status: 200, description: 'Contract in effect', type: WorkerContractEntity })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 404, description: 'Worker not found or no contract in effect on that date' })
  async findCurrentContract(
    @Param('id', ParseIntPipe) id: number,
    @Query('date') date: string,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
  ) {
    if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('date must have the format YYYY-MM-DD');
    }
    return this.handleContract(await this.workerContractService.findCurrent(id, siteId, role, date));
  }

  @Post(':id/contracts/:contractId/renew')
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH)
  @ApiTags('Worker contracts')
  @ApiOperation({
    summary: 'Renew worker contract',
    description:
      'Registers a new contract starting the day after the endDate of the renewed one, with the same company, worker type and contractType. ' +
      'If endDate is omitted, the date calculated for the contractType is used. Roles: SUPERADMIN, ADMIN, GH.',
  })
  @ApiParam({ name: 'id', type: Number, example: 128, description: 'Worker id' })
  @ApiParam({ name: 'contractId', type: Number, example: 1, description: 'Contract to renew' })
  @ApiResponse({ status: 201, description: 'Renewal contract created', type: WorkerContractEntity })
  @ApiResponse({ status: 400, description: 'endDate exceeds the limits of the contractType' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'User role is not allowed' })
  @ApiResponse({ status: 404, description: 'Contract (of this worker) not found' })
  @ApiResponse({ status: 409, description: 'Contract cannot be renewed (INDEFINITE, legacy or incomplete) or the period overlaps another contract' })
  async renewContract(
    @Param('id', ParseIntPipe) id: number,
    @Param('contractId', ParseIntPipe) contractId: number,
    @Body() dto: RenewWorkerContractDto,
    @CurrentUser('userId') userId: number,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
  ) {
    return this.handleContract(
      await this.workerContractService.renew(id, contractId, dto, userId, siteId, role),
    );
  }

  @Patch(':id/contracts/:contractId')
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH)
  @ApiTags('Worker contracts')
  @ApiOperation({
    summary: 'Update worker contract',
    description:
      'Updates company, dates, worker type or contractType of a contract of the worker. Setting endDate closes the contract (also INDEFINITE ones). ' +
      'endDate cannot exceed the maximum of its contractType (use renew instead), except APPRENTICESHIP contracts, whose endDate can only be extended by GH. ' +
      'Also used to complete legacy contracts. Roles: SUPERADMIN, ADMIN, GH.',
  })
  @ApiParam({ name: 'id', type: Number, example: 128, description: 'Worker id' })
  @ApiParam({ name: 'contractId', type: Number, example: 1 })
  @ApiResponse({ status: 200, description: 'Contract updated', type: WorkerContractEntity })
  @ApiResponse({ status: 400, description: 'Invalid data, startDate after endDate or company not ACTIVE' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'User role is not allowed, or extending an APPRENTICESHIP contract without GH role' })
  @ApiResponse({ status: 404, description: 'Contract (of this worker) or company not found' })
  @ApiResponse({ status: 409, description: 'Overlaps another contract or worker is DEACTIVATED and the contract is not finished' })
  async updateContract(
    @Param('id', ParseIntPipe) id: number,
    @Param('contractId', ParseIntPipe) contractId: number,
    @Body() dto: UpdateWorkerContractDto,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
  ) {
    return this.handleContract(await this.workerContractService.update(contractId, dto, siteId, role, id));
  }

  @Delete(':id/contracts/:contractId')
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH)
  @ApiTags('Worker contracts')
  @ApiOperation({
    summary: 'Delete worker contract',
    description: 'Deletes a contract registered by mistake. Contracts referenced by inabilities cannot be deleted. Roles: SUPERADMIN, ADMIN, GH.',
  })
  @ApiParam({ name: 'id', type: Number, example: 128, description: 'Worker id' })
  @ApiParam({ name: 'contractId', type: Number, example: 1 })
  @ApiResponse({ status: 200, description: 'Contract deleted', type: WorkerContractEntity })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'User role is not allowed' })
  @ApiResponse({ status: 404, description: 'Contract (of this worker) not found' })
  @ApiResponse({ status: 409, description: 'Contract is referenced by inabilities' })
  async removeContract(
    @Param('id', ParseIntPipe) id: number,
    @Param('contractId', ParseIntPipe) contractId: number,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
  ) {
    return this.handleContract(await this.workerContractService.remove(contractId, siteId, role, id));
  }

  //   @Get()
  // async findAll(
  //   @CurrentUser('siteId') siteId: number,
  //   @CurrentUser('subsiteId') subsiteId?: number | null, // Agregar este parámetro
  // ) {
  //   const response = await this.workerService.findAll(siteId, subsiteId);
  //   return response;
  // }
  // async findAll(
  //   @Query('format') format: string = 'json',
  //   @Res({ passthrough: true }) res: Response,
  //   @CurrentUser('siteId') siteId: number,
  // ) {
  //   const response = await this.workerService.findAll(siteId);
  //   if (!Array.isArray(response)) {
  //     return response;
  //   }
  //   if (format === 'excel') {
  //     return this.excelExportService.exportToExcel(
  //       res,
  //       response,
  //       'Trabajadores',
  //       'Trabajadores',
  //       'binary',
  //     );
  //   }

  //   return response;
  // }

 @Get(':dni')
@ApiOperation({ summary: 'Obtener trabajador por DNI' })
@ApiParam({
  name: 'dni',
  description: 'DNI del trabajador',
  example: '1040354210'
})
async findOne(
  @Param('dni') dni: string,
  @CurrentUser('siteId') siteId: number,
) {
  try {
    console.log(`[WorkerController] GET /:dni - DNI: ${dni}, siteId: ${siteId}`);
    const result = await this.workerService.findOne(dni, siteId); // ✅ Correcto: string
    return result;
  } catch (error) {
    console.error('[WorkerController] Error en findOne:', error);
    throw error;
  }
}

@Get('by-id/:id')
@ApiOperation({ summary: 'Obtener trabajador por ID' })
@ApiParam({
  name: 'id',
  description: 'ID del trabajador',
  example: '1'
})
async findById(
  @Param('id') id: string,
  @CurrentUser('siteId') siteId: number,
) {
  try {
    const workerId = parseInt(id, 10);
    console.log(`[WorkerController] GET /by-id/:id - ID: ${workerId}, siteId: ${siteId}`);
    
    if (isNaN(workerId)) {
      return { message: 'Invalid worker ID', status: 400 };
    }
    
    const result = await this.workerService.findById(workerId, siteId); // ✅ Correcto: number
    return result;
  } catch (error) {
    console.error('[WorkerController] Error en findById:', error);
    throw error;
  }
}

  @Patch(':id')
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH, Role.RECEPTION)
async update(
  @Param('id', ParseIntPipe) id: number,
  @Body() updateWorkerDto: UpdateWorkerDto,
  @CurrentUser('siteId') siteId: number,
  @CurrentUser('subsiteId') subsiteId: number,
  @CurrentUser('isSupervisor') isSupervisor: boolean,
  @CurrentUser('role') role: string,
  @CurrentUser('userId') userId: number,
) {
  // ✅ CAMBIAR A findById en lugar de findOne
  const validateId = await this.workerService.findById(id, siteId);
  
  if ('status' in validateId && validateId.status === 404) {
    throw new NotFoundException(validateId.message);
  }

  if ('id_site' in validateId && validateId.id_site !== siteId) {
    throw new ForbiddenException(
      `You can only update workers in your site (${siteId})`,
    );
  }

  // if (isSupervisor && 'id_subsite' in validateId && validateId.id_subsite !== subsiteId) {
  //   throw new ForbiddenException(
  //     `You can only update workers in your subsite (${subsiteId})`,
  //   );
  // }

  const response = await this.workerService.update(
    id,
    updateWorkerDto,
    siteId,
    role,
    userId,
  );

  return this.handleContractSource(response);
}
 //remove worker
 @Delete(':id')
 @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH, Role.RECEPTION)
async remove(
  @Param('id', ParseIntPipe) id: number,
  @CurrentUser('siteId') siteId: number,
  @CurrentUser('role') role: string,
) {
  // ✅ CAMBIAR A findById en lugar de findOne
  const validateId = await this.workerService.findById(id, siteId);
  
  if ('status' in validateId && validateId.status === 404) {
    throw new ConflictException('Unauthorized to delete this worker');
  }
  
  // Validar acceso basado en rol
  if (role !== 'SUPERADMIN' && 'id_site' in validateId && validateId.id_site !== siteId) {
    throw new ForbiddenException(
      `You can only delete workers in your site (${siteId})`,
    );
  }
  
  const response = await this.workerService.remove(id);
  return response;
}

 /**
  * Endpoint utilitario para verificar y corregir workers ASSIGNED sin operaciones activas
  * Útil para solucionar inconsistencias cuando operaciones se marcan como COMPLETED sin liberar workers
  */
 @Post('fix-status')
 @ApiOperation({
   summary: 'Corrige workers ASSIGNED sin operaciones activas',
   description: 'Verifica todos los workers con status ASSIGNED y los marca como AVAILABLE si no tienen operaciones PENDING o INPROGRESS'
 })
 async fixWorkerStatus() {
   return await this.workerService.fixWorkerStatusForCompletedOperations();
 }
}
