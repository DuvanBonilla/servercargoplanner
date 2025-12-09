import {   Controller,
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
  ParseIntPipe, } from '@nestjs/common';
import { PermissionService } from './permission.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { SiteInterceptor } from 'src/common/interceptors/site.interceptor';
import { ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ExcelExportService } from 'src/common/validation/services/excel-export.service';
import { DateTransformPipe } from 'src/pipes/date-transform/date-transform.pipe';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { FilterPermissionDto } from './dto/filter-permission.dto';
import { Response } from 'express';
import { UpdatePermissionService } from './services/update-permission.service';

@Controller('permission')
@UseGuards(JwtAuthGuard)
@UseInterceptors(SiteInterceptor)
@ApiBearerAuth('access-token')

export class PermissionController {

  constructor(private readonly permissionService: PermissionService,
    private readonly excelExportService: ExcelExportService,
    private readonly updatePermissionService: UpdatePermissionService,
  ) {}

  @Post()
  @UsePipes(DateTransformPipe)
  async create(
    @Body() createPermissionDto: CreatePermissionDto,
    @CurrentUser('userId') userId: number,
    @CurrentUser('siteId') siteId: number,
  ){
    createPermissionDto.id_user  = userId;
    const response = await this.permissionService.create(
      createPermissionDto, 
      siteId
    );
  
  if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if(response['status'] === 409) {
      throw new ConflictException(response['message']);
    }
    return response;
  }

  @Get()
  async findAll(
    @CurrentUser('siteId') siteId: number,
  ) {
    const response = await this.permissionService.findAll(siteId);
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
  ){
    const response = await this.permissionService.findOne(id, siteId);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if (response['status'] === 409) {
      throw new ConflictException(response['message']);
    }
    return response;
  }

  @Get('search/filters')
  @ApiQuery({
    name: 'format',
    required: false,
    enum: ['json', 'excel', 'base64'],
    description: 'Format of the response data',
  })

  async findByFilters(
       @Query(DateTransformPipe) filters: FilterPermissionDto,
        @Query('format') format: string = 'json',
        @Res({ passthrough: true }) res: Response,
        @CurrentUser('siteId') siteId: number,
    ) {
      if(siteId){
        filters.id_site = siteId;
      }
      const response = await this.permissionService.findByFilters(filters);
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
        'Permisos',
        'Reporte de Permisos',
        'binary',
      );
    }

    if (format === 'base64') {
      return this.excelExportService.exportToExcel(
        null,
        response,
        'Permisos',
        'Reporte de Permisos',
        'base64',
      );
    }
    return response;
  }
  

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() UpdatePermissionDto: UpdatePermissionDto,
    @CurrentUser('siteId') siteId: number
  ) {
    const response = await this.permissionService.update(
      id, UpdatePermissionDto, 
      siteId);
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
    const response = await this.permissionService.remove(id, siteId);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if (response['status'] === 409) {
      throw new ConflictException(response['message']);
    }
    return response;
  }

  @Post('admin/test-update-expired')
  async testUpdateExpiredPermissions() {
    return await this.updatePermissionService.updateWorkersWithExpiredPermissions();
  }
}
