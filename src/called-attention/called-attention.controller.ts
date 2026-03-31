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
  BadRequestException,
  UseGuards,
  Query,
  Res,
  ValidationPipe,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { CalledAttentionService } from './called-attention.service';
import { CreateCalledAttentionDto } from './dto/create-called-attention.dto';
import { UpdateCalledAttentionDto } from './dto/update-called-attention.dto';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ParseIntPipe } from 'src/pipes/parse-int/parse-int.pipe';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiParam } from '@nestjs/swagger';
// import { ExcelExportService } from 'src/common/validation/services/excel-export.service';
import { FilterCalledAttentionDto } from './dto/filter-called-attention';
import { PaginatedCalledAttentionQueryDto } from './dto/paginate-called-attention.dto';
import { BooleanTransformPipe } from 'src/pipes/boolean-transform/boolean-transform.pipe';
import { SiteInterceptor } from 'src/common/interceptors/site.interceptor';
import { Site } from 'src/site/entities/site.entity';

@Controller('called-attention')
@UseGuards(JwtAuthGuard)
@UseInterceptors(SiteInterceptor)
@ApiBearerAuth('access-token')
export class CalledAttentionController {
  constructor(
    private readonly calledAttentionService: CalledAttentionService,
    // private readonly excelExportService: ExcelExportService,
  ) {}

  @Post()
  async create(
    @Body() createCalledAttentionDto: CreateCalledAttentionDto,
    @CurrentUser('userId') userId: number,
    @CurrentUser('siteId') id_site: number,
  ) {
    createCalledAttentionDto.id_user = userId;
    if(createCalledAttentionDto){}
    const response = await this.calledAttentionService.create(
      createCalledAttentionDto,
      id_site,
    );
    if (response['status'] === 409) {
      throw new ConflictException(response['message']);
    } else if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if (response['status'] === 400) {
      throw new BadRequestException(response['message']);
    }
    return response;
  }

  @Get('by-worker/:id')
  async findWorker(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('siteId') id_site: number,
  ) {
    const response = await this.calledAttentionService.findOneByIdWorker(
      id,
      id_site,
    );
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if (response['status'] === 400) {
      throw new BadRequestException(response['message']);
    }
    return response;
  }

  @Get('paginated')
  @ApiOperation({
    summary: 'Obtener llamadas de atención con paginación y filtros opcionales',
  })
  @ApiQuery({
    name: 'activatePaginated',
    required: false,
    type: Boolean,
    description:
      'Si es false, devuelve todos los registros sin paginación. Por defecto: true',
  })
  async findPaginated(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    queryParams: PaginatedCalledAttentionQueryDto,
    @Query('activatePaginated', new BooleanTransformPipe(true))
    activatePaginated: boolean,
    @CurrentUser('siteId') id_site: number,
  ) {
    try {
      // Construir el objeto de filtros
      const filters: FilterCalledAttentionDto = {};

      if (id_site) {
        filters.id_site = id_site;
      }

      if (queryParams.type) {
        filters.type = queryParams.type;
      }

      if (queryParams.startDate) {
        filters.startDate = queryParams.startDate;
      }

      if (queryParams.endDate) {
        filters.endDate = queryParams.endDate;
      }

      if (queryParams.search && queryParams.search.trim() !== '') {
        filters.search = queryParams.search.trim();
      }

      // Si activatePaginated es falso, establecerlo en el objeto filters
      if (activatePaginated === false) {
        filters.activatePaginated = false;
      }

      // Obtener los datos paginados
      return await this.calledAttentionService.findAllPaginated(
        queryParams.page || 1,
        queryParams.limit || 10,
        filters,
        activatePaginated,
      );
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new Error(`Error processing paginated request: ${error.message}`);
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
  async findAll(
    @Query('format') format: string = 'json',
    @Res({ passthrough: true }) res: Response,
    @CurrentUser('siteId') id_site: number,
  ) {
    const response = await this.calledAttentionService.findAll(
      id_site,
    );

   

    // Si no hay datos o hay un error, devolver la respuesta original
    if (!Array.isArray(response)) {
      return response;
    }

    if (format === 'excel') {
      // Para Excel necesitamos control total de la respuesta (passthrough: false)
      // return this.excelExportService.exportToExcel(
      //   res,
      //   response,
      //   'llamados_atencion',
      //   'Llamados de Atención',
      //   'binary',
      // );
    }

    if (format === 'base64') {
      // Generar Excel en Base64
      // return this.excelExportService.exportToExcel(
      //   null,
      //   response,
      //   'llamados_atencion',
      //   'Llamados de Atención',
      //   'base64',
      // );
    }

    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }

    // Formato JSON por defecto (con passthrough: true)
    return response;
  }
  @Get(':id')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('siteId') id_site: number,
  ) {
    const response = await this.calledAttentionService.findOne(
      id,
      id_site,
    );
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if (response['status'] === 400) {
      throw new BadRequestException(response['message']);
    }
    return response;
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateCalledAttentionDto: UpdateCalledAttentionDto,
    @CurrentUser('userId') userId: number,
    @CurrentUser('siteId') id_site: number,
  ) {
    updateCalledAttentionDto.id_user = userId;
    const response = await this.calledAttentionService.update(
      id,
      updateCalledAttentionDto,
      id_site,
    );
    if (response['status'] === 409) {
      throw new ConflictException(response['message']);
    } else if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if (response['status'] === 400) {
      throw new BadRequestException(response['message']);
    }
    return response;
  }

  @Delete(':id')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('siteId') id_site: number,
  ) {
    const response = await this.calledAttentionService.remove(id, id_site);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if (response['status'] === 400) {
      throw new BadRequestException(response['message']);
    } else if (response['status'] === 409) {
      throw new ConflictException(response['message']);
    }

    return response;
  }

  @Get('worker/:dni')
  @ApiOperation({ 
    summary: 'Obtener atenciones por DNI del trabajador',
    description: 'Busca todas las atenciones llamadas de un trabajador específico por su DNI'
  })
  @ApiParam({
    name: 'dni',
    description: 'DNI del trabajador',
    example: '12345678'
  })
  async findByWorkerDni(
    @Param('dni') dni: string,
    @CurrentUser('siteId') siteId: number,
  ) {
    const response = await this.calledAttentionService.findByWorkerDni(dni, siteId);
    return response;
  }

  @Get('search/:term')
  @ApiOperation({ 
    summary: 'Buscar atenciones por texto',
    description: 'Busca atenciones por DNI, nombre del trabajador o descripción'
  })
  @ApiParam({
    name: 'term',
    description: 'Término de búsqueda',
    example: 'Juan'
  })
  async searchAttentions(
    @Param('term') searchTerm: string,
    @CurrentUser('siteId') siteId: number,
  ) {
    return await this.calledAttentionService.searchAttentions(searchTerm, siteId);
  }
}
