import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UsePipes,
  NotFoundException,
  UseGuards,
  Query,
  Res,
  BadRequestException,
  ValidationPipe,
  ConflictException,
  UseInterceptors,
  ForbiddenException,
} from '@nestjs/common';
import { OperationService } from './operation.service';
import { Response } from 'express';
import { CreateOperationDto } from './dto/create-operation.dto';
import { UpdateOperationDto } from './dto/update-operation.dto';
import { ParseIntPipe } from 'src/pipes/parse-int/parse-int.pipe';
import { DateTransformPipe } from 'src/pipes/date-transform/date-transform.pipe';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { Role, StatusOperation } from '@prisma/client';
import { ExcelExportService } from 'src/common/validation/services/excel-export.service';
import { OperationFilterDto } from './dto/fliter-operation.dto';
import { PaginatedOperationQueryDto } from './dto/paginated-operation-query.dto';
import { BooleanTransformPipe } from 'src/pipes/boolean-transform/boolean-transform.pipe';
import { WorkerAnalyticsService } from './services/workerAnalytics.service';
import { SiteInterceptor } from 'src/common/interceptors/site.interceptor';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { WorkerDistributionQueryDto } from './dto/worker-distribution-query.dto';
import { getColombianDateTime } from 'src/common/utils/dateColombia';
import { WorkerHoursReportQueryDto } from './dto/worker-hours-report-query.dto';
@Controller('operation')
@UseInterceptors(SiteInterceptor)
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPERVISOR, Role.ADMIN, Role.SUPERADMIN)
@ApiBearerAuth('access-token')
export class OperationController {
  constructor(
    private readonly operationService: OperationService,
    private readonly excelExportService: ExcelExportService,
    private readonly workerAnalyticsService: WorkerAnalyticsService,
  ) {}

  // @Post()
  // @UsePipes(new DateTransformPipe())
  // @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  // async create(
  //   @Body() createOperationDto: CreateOperationDto,
  //   @CurrentUser('siteId') siteId: number,
  //   @CurrentUser('subsiteId') subsiteId: number,
  //    @CurrentUser('userId') userId: number,
  // ) {
  //   createOperationDto.id_user = userId;
  //   createOperationDto.id_site = siteId;
  //   createOperationDto.id_subsite = subsiteId;
  //   const response = await this.operationService.createWithWorkers(
  //     createOperationDto,
  //     subsiteId,
  //     siteId,
  //   );
  //   if (response['status'] === 404) {
  //     throw new NotFoundException(response['message']);
  //   } else if (response['status'] === 409) {
  //     throw new ConflictException(response['message']);
  //   } else if (response['status'] === 400) {
  //     throw new BadRequestException(response['message']);
  //   } else if (response['status'] === 403) {
  //     throw new ForbiddenException(response['message']);
  //   }
  //   return response;
  // }

@Post()
@UsePipes(new DateTransformPipe())
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
async create(
  @Body() createOperationDto: CreateOperationDto,
  @CurrentUser('siteId') siteId: number,
  @CurrentUser('subsiteId') subsiteId: number,
  @CurrentUser('userId') userId: number,
) {
  
console.log('Body crudo recibido:', arguments[0]);
  // LOG para ver lo que llega del frontend
  console.log('DTO recibido en controlador:', createOperationDto);
  createOperationDto.id_user = userId;

  if (typeof createOperationDto.id_site === 'undefined' || createOperationDto.id_site === null) {
    createOperationDto.id_site = siteId;
  }

  // Si el frontend NO envía id_subsite, usa el del usuario (puede ser null)
  if (typeof createOperationDto.id_subsite === 'undefined' || createOperationDto.id_subsite === null) {
    createOperationDto.id_subsite = subsiteId;
  }

  const response = await this.operationService.createWithWorkers(
    createOperationDto,
    createOperationDto.id_subsite,
    createOperationDto.id_site,
  );

  if (response['status'] === 404) {
    throw new NotFoundException(response['message']);
  } else if (response['status'] === 409) {
    throw new ConflictException(response['message']);
  } else if (response['status'] === 400) {
    throw new BadRequestException(response['message']);
  } else if (response['status'] === 403) {
    throw new ForbiddenException(response['message']);
  }
  return response;
}

  @Get()
  @ApiQuery({
    name: 'format',
    required: false,
    enum: ['json', 'excel', 'base64'],
    description:
      'Formato de respuesta: json por defecto o excel para exportación',
  })
  async findAll(
    @Query('format') format: 'json' | 'excel' | 'base64',
    @Res({ passthrough: true }) res: Response,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('subsiteId') subsiteId: number,
  ) {
    const response = await this.operationService.findAll(siteId, subsiteId);

    if (!Array.isArray(response)) {
      return response;
    }
    if (format === 'excel') {
      return this.excelExportService.exportToExcel(
        res,
        response,
        'operations',
        'Operaciones',
        'binary',
      );
    }
    if (format === 'base64') {
      return this.excelExportService.exportToExcel(
        res,
        response,
        'operations',
        'Operaciones',
        'base64',
      );
    }
    return response;
  }

  @Get('analytics/worker-distribution')
  @ApiOperation({
    summary: 'Get worker distribution by hour for a specific date',
  })
  async getWorkerDistributionByHour(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    queryDto: WorkerDistributionQueryDto,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('subsiteId') subsiteId: number,
  ) {
    if (!queryDto.date) {
      const today = getColombianDateTime();
      queryDto.date = today.toISOString().split('T')[0];
    }
    return this.workerAnalyticsService.getWorkerDistributionByHour(
      queryDto.date,
      siteId,
      subsiteId,
    );
  }

  @Get('analytics/worker-hours')
  @ApiOperation({ summary: 'Get monthly report of hours worked per worker' })
  async getWorkerHoursReport(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    queryDto: WorkerHoursReportQueryDto,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('subsiteId') subsiteId: number,
  ) {
    const month = queryDto.month || new Date().getMonth() + 1;
    const year = queryDto.year || new Date().getFullYear();
    return this.workerAnalyticsService.getWorkerHoursReport(
      month,
      year,
      siteId,
      subsiteId,
    );
  }

  @Get('paginated')
  @ApiOperation({
    summary: 'Obtener operaciones con paginación y filtros opcionales',
  })
  @ApiQuery({
    name: 'activatePaginated',
    required: false,
    type: Boolean,
    description:
      'Si es false, devuelve todos los registros sin paginación. Por defecto: true',
  })
  async findAllPaginated(
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('subsiteId') subsiteId: number,
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    queryParams: PaginatedOperationQueryDto,
    @Query('activatePaginated', new BooleanTransformPipe(true))
    activatePaginated: boolean,
  ) {
    try {
      // Construir el objeto de filtros
      const filters: OperationFilterDto = {};

      if (siteId) {
        filters.id_site = siteId;
      }
      if (subsiteId) {
        filters.id_subsite = subsiteId;
      }
      if (queryParams.status && queryParams.status.length > 0) {
        filters.status = queryParams.status;
      }

      if (queryParams.dateStart) {
        filters.dateStart = queryParams.dateStart;
      }

      if (queryParams.dateEnd) {
        filters.dateEnd = queryParams.dateEnd;
      }

      if (queryParams.jobAreaId && queryParams.jobAreaId > 0) {
        filters.jobAreaId = queryParams.jobAreaId;
      }

      if (queryParams.userId && queryParams.userId > 0) {
        filters.userId = queryParams.userId;
      }

      if (queryParams.inChargedId && queryParams.inChargedId > 0) {
        filters.inChargedId = queryParams.inChargedId;
      }

      if (queryParams.search && queryParams.search.trim() !== '') {
        filters.search = queryParams.search.trim();
      }

      // Obtener los datos paginados con el valor transformado
      return await this.operationService.findAllPaginated(
        queryParams.page || 1,
        queryParams.limit || 10,
        filters,
        activatePaginated, // Usar el valor transformado por el pipe
      );
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new Error(`Error processing paginated request: ${error.message}`);
    }
  }

  @Get('by-status')
  async findByStatus(
    @Query('status') statusParam: StatusOperation | StatusOperation[],
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('subsiteId') subsiteId: number,
  ) {
    // Si no se proporciona un parámetro, usar los estados por defecto
    const statuses = statusParam
      ? Array.isArray(statusParam)
        ? statusParam
        : [statusParam]
      : [StatusOperation.INPROGRESS, StatusOperation.PENDING];

    // Validar que todos los estados sean del enum StatusOperation
    const validStatuses = Object.values(StatusOperation);
    const filteredStatuses = statuses.filter((status) =>
      validStatuses.includes(status as StatusOperation),
    ) as StatusOperation[];

    // Si después de filtrar no quedan estados válidos, usar los por defecto
    const statusesToUse =
      filteredStatuses.length > 0
        ? filteredStatuses
        : [StatusOperation.INPROGRESS, StatusOperation.PENDING];

    const response = await this.operationService.findActiveOperations(
      statusesToUse,
      siteId,
      subsiteId,
    );

    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }

    return response;
  }

  @Get('by-date')
  async findByDate(
    @Query('dateStart', DateTransformPipe) dateStart: Date,
    @Query('dateEnd', DateTransformPipe) dateEnd: Date,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('subsiteId') subsiteId: number,
  ) {
    const response = await this.operationService.findOperationRangeDate(
      dateStart,
      dateEnd,
      siteId,
      subsiteId,
    );
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    return response;
  }

  @Get('by-user')
  async findByWorker(
    @CurrentUser('userId') id: number,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('subsiteId') subsiteId: number,
  ) {
    const response = await this.operationService.findOperationByUser(
      id,
      siteId,
      subsiteId,
    );
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    return response;
  }

  @Get('detailsTariff/:id')
  async getOperationWithDetailedTariffs(@Param('id', ParseIntPipe) id: number) {
    const response =
      await this.operationService.getOperationWithDetailedTariffs(id);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    return response;
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('subsiteId') subsiteId: number,
  ) {
    const response = await this.operationService.findOne(id, siteId, subsiteId);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    return response;
  }

  @Patch(':id')
  @UsePipes(new DateTransformPipe())
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateOperationDto: UpdateOperationDto,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('subsiteId') subsiteId: number,
  ) {
    const response = await this.operationService.update(
      id,
      updateOperationDto,
      subsiteId,
      siteId,
    );
    if (response && response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if (response && response['status'] === 400) {
      throw new BadRequestException(response['message']);
    }
    return response;
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Eliminar operación o grupo específico',
    description:
      'Si id_group no se proporciona: si hay un solo grupo se elimina automáticamente, si hay múltiples grupos devuelve la lista para que el usuario elija. Solo se pueden eliminar grupos con facturas en estado ACTIVE.',
  })
  @ApiQuery({
    name: 'id_group',
    required: false,
    type: String,
    description: 'ID del grupo a eliminar (opcional)',
  })
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Query('id_group') id_group: string,
    @CurrentUser('userId') userId: number,
    @CurrentUser('isSupervisor') isSupervisor: number,
    @CurrentUser('isAdmin') isAdmin: number,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('subsiteId') subsiteId: number,
  ) {
    const response = await this.operationService.remove(
      id,
      isAdmin ? siteId : undefined,
      isSupervisor ? subsiteId : undefined,
      id_group || undefined,
      userId,
    );
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if (response['status'] === 400) {
      throw new BadRequestException(response['message']);
    } else if (response['status'] === 403) {
      throw new ForbiddenException(response['message']);
    }

    return response;
  }

  @Delete(':id/groups/bulk')
  @ApiOperation({
    summary: 'Eliminar múltiples grupos de una operación',
    description:
      'Elimina varios grupos a la vez aplicando las mismas validaciones: no permite eliminar grupos con facturas COMPLETED y SUPERVISOR solo puede eliminar de la semana actual.',
  })
  @ApiBody({
    description: 'Array de IDs de grupos a eliminar',
    schema: {
      type: 'object',
      properties: {
        id_groups: {
          type: 'array',
          items: {
            type: 'string',
          },
          example: [
            '83f2e536-f56c-4af4-8cf6-28b880b89309',
            'a19a3bde-a8c8-4b7e-a8cc-cd24e51f8d67',
            'f4d3c2b1-a0e9-4d8c-b7a6-5e4d3c2b1a09',
          ],
          description: 'Lista de UUIDs de los grupos a eliminar',
        },
      },
      required: ['id_groups'],
    },
  })
  async removeMultipleGroups(
    @Param('id', ParseIntPipe) id: number,
    @Body('id_groups') id_groups: string[],
    @CurrentUser('userId') userId: number,
    @CurrentUser('isSupervisor') isSupervisor: number,
    @CurrentUser('isAdmin') isAdmin: number,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('subsiteId') subsiteId: number,
  ) {
    if (!id_groups || !Array.isArray(id_groups) || id_groups.length === 0) {
      throw new BadRequestException('Se requiere un array de id_groups con al menos un elemento');
    }

    const response = await this.operationService.removeMultipleGroups(
      id,
      id_groups,
      isAdmin ? siteId : undefined,
      isSupervisor ? subsiteId : undefined,
      userId,
    );

    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if (response['status'] === 400) {
      throw new BadRequestException(response['message']);
    } else if (response['status'] === 403) {
      throw new ForbiddenException(response['message']);
    } else if (response['status'] === 207) {
      // 207 Multi-Status: algunos grupos se eliminaron, otros no
      return response;
    }

    return response;
  }
}
