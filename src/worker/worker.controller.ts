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
} from '@nestjs/common';
import { WorkerService } from './worker.service';
import { Response } from 'express';
import { CreateWorkerDto } from './dto/create-worker.dto';
import { UpdateWorkerDto } from './dto/update-worker.dto';
import { ParseIntPipe } from 'src/pipes/parse-int/parse-int.pipe';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery } from '@nestjs/swagger';
import { DateTransformPipe } from 'src/pipes/date-transform/date-transform.pipe';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ExcelExportService } from 'src/common/validation/services/excel-export.service';
import { SiteInterceptor } from 'src/common/interceptors/site.interceptor';
/**
 * @category Controller
 */
@Controller('worker')
@UseGuards(JwtAuthGuard)
@UseInterceptors(SiteInterceptor)
@ApiBearerAuth('access-token')
export class WorkerController {
  private recentRequests = new Map<string, { timestamp: number; processing: boolean }>();
  private readonly DUPLICATE_WINDOW_MS = 5000; // 5 segundos para considerar duplicado

  constructor(
    private readonly workerService: WorkerService,
    private readonly excelExportService: ExcelExportService,
  ) {}

 @Post()
async create(
  @Body() createWorkerDto: CreateWorkerDto,
  @CurrentUser('userId') userId: number,
  @CurrentUser('siteId') siteId: number,
  @CurrentUser('subsiteId') subsiteId: number,
) {
    const requestId = Math.random().toString(36).substring(7);
    console.log(`[WorkerController] 🚀 ${requestId} - POST /worker initiated`);
    console.log(`[WorkerController] ${requestId} - createWorkerDto:`, createWorkerDto);
    console.log(`[WorkerController] ${requestId} - userId: ${userId}, siteId: ${siteId}, subsiteId: ${subsiteId}`);
    
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
        console.log(`[WorkerController] ${requestId} - ⚠️ PETICIÓN DUPLICADA DETECTADA (procesando), rechazando...`);
        throw new ConflictException('Duplicate request detected - already processing');
      } else {
        console.log(`[WorkerController] ${requestId} - ⚠️ PETICIÓN DUPLICADA DETECTADA (reciente), rechazando...`);
        throw new ConflictException('Duplicate request detected - request processed recently');
      }
    }
    
    // Marcar petición como en proceso
    this.recentRequests.set(requestKey, { timestamp: now, processing: true });
    
    try {
      // Agrega el log aquí
      console.log('subsiteId recibido:', subsiteId);
      createWorkerDto.id_user = userId;

    if (typeof createWorkerDto.id_site === 'undefined' || createWorkerDto.id_site === null) {
      createWorkerDto.id_site = siteId;
    }
    if (typeof createWorkerDto.id_subsite === 'undefined' || createWorkerDto.id_subsite === null) {
      createWorkerDto.id_subsite = subsiteId;
    }

      console.log(`[WorkerController] ${requestId} - Calling workerService.create...`);
      const result = await this.workerService.create(createWorkerDto, siteId);
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
@UsePipes(new DateTransformPipe())
async update(
  @Param('id', ParseIntPipe) id: number,
  @Body() updateWorkerDto: UpdateWorkerDto,
  @CurrentUser('siteId') siteId: number,
  @CurrentUser('subsiteId') subsiteId: number,
  @CurrentUser('isSupervisor') isSupervisor: boolean,
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

  if (isSupervisor && 'id_subsite' in validateId && validateId.id_subsite !== subsiteId) {
    throw new ForbiddenException(
      `You can only update workers in your subsite (${subsiteId})`,
    );
  }

  const response = await this.workerService.update(
    id,
    updateWorkerDto,
    siteId,
  );

  return response;
}
 //remove worker
 @Delete(':id')
async remove(
  @Param('id', ParseIntPipe) id: number,
  @CurrentUser('siteId') siteId: number,
) {
  // ✅ CAMBIAR A findById en lugar de findOne
  const validateId = await this.workerService.findById(id, siteId);
  
  if ('status' in validateId && validateId.status === 404) {
    throw new ConflictException('Unauthorized to delete this worker');
  }
  
  const response = await this.workerService.remove(id);
  return response;
}
}
