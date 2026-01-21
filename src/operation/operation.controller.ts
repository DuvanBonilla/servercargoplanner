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
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
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
    description: `
    Endpoint optimizado para manejar grandes volúmenes de datos (1000+ registros).
    
    **Características:**
    - Paginación inteligente que ajusta automáticamente los límites para datasets grandes
    - Filtros por área, estado, fechas, usuario y búsqueda de texto
    - Metadatos de rendimiento incluidos en la respuesta
    - Cache optimizado para mejor performance
    
    **Para datasets > 1000 registros:**
    - Límite máximo automático: 100 registros por página
    - Recomendación de usar filtros para reducir el conjunto de datos
    - Información adicional de rendimiento en la respuesta
    
    **Ejemplos de uso:**
    
    Paginación básica:
    \`GET /operation/paginated?page=1&limit=50\`
    
    Con filtros por estado:
    \`GET /operation/paginated?page=1&limit=20&status=PENDING,INPROGRESS\`
    
    Con filtro por área y fecha:
    \`GET /operation/paginated?jobAreaId=5&dateStart=2024-01-01&dateEnd=2024-12-31\`
    
    Búsqueda de texto:
    \`GET /operation/paginated?search=proyecto&limit=30\`
    `,
    tags: ['Operations', 'Pagination']
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Número de página (por defecto: 1)',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Elementos por página. Máximo: 500, Recomendado para datasets grandes: 100',
    example: 10,
  })
  @ApiQuery({
    name: 'status',
    required: false,
    type: [String],
    description: 'Filtrar por estado(s). Puede ser un array separado por comas',
    example: 'PENDING,INPROGRESS',
  })
  @ApiQuery({
    name: 'jobAreaId',
    required: false,
    type: Number,
    description: 'ID del área de trabajo para filtrar',
    example: 1,
  })
  @ApiQuery({
    name: 'dateStart',
    required: false,
    type: String,
    description: 'Fecha de inicio mínima (formato: YYYY-MM-DD)',
    example: '2024-01-01',
  })
  @ApiQuery({
    name: 'dateEnd',
    required: false,
    type: String,
    description: 'Fecha de fin máxima (formato: YYYY-MM-DD)',
    example: '2024-12-31',
  })
  @ApiQuery({
    name: 'inChargedId',
    required: false,
    type: Number,
    description: 'ID del usuario encargado',
    example: 1,
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Búsqueda por operación, código o subservicio',
    example: 'proyecto',
  })
  @ApiQuery({
    name: 'activatePaginated',
    required: false,
    type: Boolean,
    description: 'OBSOLETO: Siempre se aplica paginación para evitar saturación. Por defecto: true',
    example: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Operaciones obtenidas exitosamente con paginación optimizada',
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Lista de operaciones para la página actual',
          items: {
            type: 'object',
            description: 'Datos completos de la operación con relaciones incluidas'
          }
        },
        pagination: {
          type: 'object',
          properties: {
            totalItems: {
              type: 'number',
              description: 'Total de registros en la base de datos',
              example: 2500
            },
            currentPage: {
              type: 'number',
              description: 'Página actual',
              example: 1
            },
            totalPages: {
              type: 'number',
              description: 'Total de páginas disponibles',
              example: 25
            },
            itemsPerPage: {
              type: 'number',
              description: 'Elementos por página',
              example: 100
            },
            hasNextPage: {
              type: 'boolean',
              description: 'Indica si hay página siguiente',
              example: true
            },
            hasPreviousPage: {
              type: 'boolean',
              description: 'Indica si hay página anterior',
              example: false
            },
            isLargeDataset: {
              type: 'boolean',
              description: 'Indica si es un dataset grande (>1000 registros)',
              example: true
            },
            recommendedPageSize: {
              type: 'number',
              description: 'Tamaño de página recomendado para óptimo rendimiento',
              example: 100
            },
            performanceHint: {
              type: 'object',
              description: 'Sugerencias de optimización (solo para datasets grandes)',
              properties: {
                message: {
                  type: 'string',
                  example: 'Dataset grande detectado. Considera usar filtros para reducir el conjunto de datos.'
                },
                recommendedPageSize: {
                  type: 'number',
                  example: 100
                },
                totalDataSizeCategory: {
                  type: 'string',
                  enum: ['large', 'very-large'],
                  example: 'large'
                }
              }
            }
          }
        },
        nextPages: {
          type: 'array',
          description: 'Páginas adicionales pre-cargadas (optimización deshabilitada para datasets grandes)',
          items: {
            type: 'object'
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: 'Parámetros de consulta inválidos'
  })
  @ApiResponse({
    status: 401,
    description: 'Token de autenticación inválido o faltante'
  })
  @ApiResponse({
    status: 403,
    description: 'Sin permisos para acceder a este recurso'
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

      // Validar y ajustar límite para grandes datasets
      let adjustedLimit = queryParams.limit || 10;
      
      // Para evitar sobrecarga, sugerir límites menores en requests grandes
      if (adjustedLimit > 200) {
        console.warn(`Límite alto solicitado: ${adjustedLimit}. Considera usar límites menores para mejor rendimiento.`);
      }

      // Obtener los datos paginados con el valor transformado
      const result = await this.operationService.findAllPaginated(
        queryParams.page || 1,
        adjustedLimit,
        filters,
        activatePaginated, // Usar el valor transformado por el pipe
      );
      
      // Agregar metadatos útiles para el frontend
      if (result.pagination && result.pagination.totalItems > 1000) {
        result.pagination['performanceHint'] = {
          message: 'Dataset grande detectado. Considera usar filtros para reducir el conjunto de datos.',
          recommendedPageSize: Math.min(100, adjustedLimit),
          totalDataSizeCategory: result.pagination.totalItems > 5000 ? 'very-large' : 'large'
        };
      }
      
      return result;
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
