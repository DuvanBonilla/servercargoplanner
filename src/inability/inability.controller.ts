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
  UseInterceptors,
  ConflictException,
} from '@nestjs/common';
import { InabilityService } from './inability.service';
import { CreateInabilityDto } from './dto/create-inability.dto';
import { UpdateInabilityDto } from './dto/update-inability.dto';
import { DateTransformPipe } from 'src/pipes/date-transform/date-transform.pipe';
import { ParseIntPipe } from 'src/pipes/parse-int/parse-int.pipe';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { FilterInabilityDto } from './dto/filter-inability';
import { Response } from 'express';
import { ExcelExportService } from 'src/common/validation/services/excel-export.service';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { SiteInterceptor } from 'src/common/interceptors/site.interceptor';
import { UpdateInabilityService } from './service/update-inability.service';

@Controller('inability')
@UseGuards(JwtAuthGuard)
@UseInterceptors(SiteInterceptor)
@ApiBearerAuth('access-token')
export class InabilityController {
  constructor(
    private readonly inabilityService: InabilityService,
    private readonly excelExportService: ExcelExportService,
    private readonly updateInabilityService: UpdateInabilityService,
  ) {}

  @Post()
  @UsePipes(DateTransformPipe)
  async create(
    @Body() createInabilityDto: CreateInabilityDto,
    @CurrentUser('userId') userId: number,
    @CurrentUser('siteId') siteId: number,
  ) {
    createInabilityDto.id_user = userId;
    const response = await this.inabilityService.create(
      createInabilityDto,
      siteId,
    );
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if (response['status'] === 409) {
      throw new ConflictException(response['message']);
    }
    return response;
  }

  @Get()
  async findAll(
    @CurrentUser('siteId') siteId: number,
  ) {
    const response = await this.inabilityService.findAll(siteId);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if (response['status'] === 409) {
      throw new ConflictException(response['message']);
    }
    return response;
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('siteId') siteId: number,
  ) {
    const response = await this.inabilityService.findOne(id, siteId);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    return response;
  }
  @Get('search/filters')
  @ApiQuery({
    name: 'format',
    required: false,
    enum: ['json', 'excel', 'base64'],
    description:
      'Formato de respuesta: json por defecto o excel para exportación',
  })
  async findByFilters(
    @Query(DateTransformPipe) filters: FilterInabilityDto,
    @Query('format') format: string = 'json',
    @Res({ passthrough: true }) res: Response,
    @CurrentUser('siteId') siteId: number,
  ) {
    if (siteId) {
      filters.id_site = siteId;
    }
    const response = await this.inabilityService.findByFilters(filters);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    if (!Array.isArray(response)) {
      return response;
    }
    if (format === 'excel') {
      return this.excelExportService.exportToExcel(
        res,
        response,
        'incapacidades',
        'Reporte de Incapacidades',
        'binary',
      );
    }

    if (format === 'base64') {
      return this.excelExportService.exportToExcel(
        null,
        response,
        'incapacidades',
        'Reporte de Incapacidades',
        'base64',
      );
    }
    return response;
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateInabilityDto: UpdateInabilityDto,
    @CurrentUser('siteId') siteId: number,
  ) {
    const response = await this.inabilityService.update(
      id,
      updateInabilityDto,
      siteId,
    );
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if (response['status'] === 409) {
      throw new ConflictException(response['message']);
    }
    return response;
  }

  @Delete(':id')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('siteId') siteId: number,
  ) {
    const response = await this.inabilityService.remove(id, siteId);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }else if (response['status'] === 409) {
      throw new ConflictException(response['message']);
    }
    return response;
  }

  @Post('admin/test-update-expired')
  async testUpdateExpiredInabilities() {
    return await this.updateInabilityService.updateWorkersWithExpiredInabilities();
  }
}

