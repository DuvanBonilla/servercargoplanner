import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Query,
  UseGuards,
  UseInterceptors,
  StreamableFile,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ZoneService } from './zone.service';
import { ZoneExportService } from './zone-export.service';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { ExportZoneDto } from './dto/export-zone.dto';
import { ParseIntPipe } from 'src/pipes/parse-int/parse-int.pipe';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { SiteInterceptor } from 'src/common/interceptors/site.interceptor';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiProduces } from '@nestjs/swagger';
import { Role } from '@prisma/client';

// Controlador REST del módulo Zona: expone /api/zone (CRUD) y /api/zone/export
// Requiere JWT válido (JwtAuthGuard) y rol autorizado (RolesGuard); SiteInterceptor
// agrega al request la sede/subsede/rol del usuario decodificados del token.
@Controller('zone')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPERADMIN, Role.ADMIN, Role.SUPERVISOR)
@ApiBearerAuth('access-token')
@UseInterceptors(SiteInterceptor)
export class ZoneController {
  constructor(
    private readonly zoneService: ZoneService,
    private readonly zoneExportService: ZoneExportService,
  ) {}


  @Post()
  async create(
    @Body() createZoneDto: CreateZoneDto,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('subsiteId') subsiteId: number,
    @CurrentUser('userId') userId: number,
  ) {
    createZoneDto.id_user = userId;

    if (typeof createZoneDto.id_site === 'undefined' || createZoneDto.id_site === null) {
      createZoneDto.id_site = siteId;
    }
    if (typeof createZoneDto.id_subsite === 'undefined' || createZoneDto.id_subsite === null) {
      createZoneDto.id_subsite = subsiteId;
    }

    const response = await this.zoneService.create(createZoneDto);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if (response['status'] === 409) {
      // Zona duplicada (mismo número + sede/subsede), detectada en ZoneService.create
      throw new ConflictException(response['message']);
    }
    return response;
  }


  @Get()
  @Roles(Role.SUPERADMIN, Role.SUPERVISOR, Role.ADMIN, Role.GH)
  async findAll(
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('subsiteId') subsiteId: number,
    @CurrentUser('role') userRole: Role,
    @Query('id_site') querySiteId?: number,
    @Query('id_subsite') querySubsiteId?: number,
  ) {
    let effectiveSubsiteId: number | undefined = subsiteId;
    let effectiveSiteId: number | undefined = siteId;

    const canSeeOtherSites =
      userRole === Role.SUPERADMIN ||
      userRole === Role.GH ||
      userRole === Role.SUPERVISOR ||
      userRole === Role.ADMIN;

    if (canSeeOtherSites) {
      if (querySiteId !== undefined && querySiteId !== null) {
        // El frontend indica explícitamente qué sede quiere ver: se filtra en la
        // consulta SQL (no se trae todo para descartarlo después en el navegador).
        effectiveSiteId = querySiteId;
        effectiveSubsiteId = querySubsiteId;
      } else if (querySubsiteId !== undefined && querySubsiteId !== null) {
        // Se pidió una subsede específica por query param: usar esa, sin restringir por sede
        effectiveSubsiteId = querySubsiteId;
        effectiveSiteId = undefined;
      } else {
        // Sin ningún filtro explícito: comportamiento amplio (todas las sedes)
        effectiveSiteId = undefined;
        effectiveSubsiteId = undefined;
      }
    }

    return this.zoneService.findAll(effectiveSiteId, effectiveSubsiteId);
  }


  @Post('export')
  @Roles(Role.SUPERADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Exportar zonas a Excel' })
  @ApiConsumes('application/x-www-form-urlencoded')
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiBody({ type: ExportZoneDto })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async exportToExcel(
    @Body() body: ExportZoneDto,
    @CurrentUser('siteId') currentSiteId: number,
  ): Promise<StreamableFile> {
    const file = await this.zoneExportService.exportToExcel(body.search, currentSiteId);

    return new StreamableFile(file.stream, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${file.fileName}"`,
    });
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('siteId') siteId: number,
  ) {
    const response = await this.zoneService.findOne(id, siteId);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    return response;
  }


  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateZoneDto: UpdateZoneDto,
    @CurrentUser('userId') userId: number,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') userRole: Role,
  ) {
    updateZoneDto.id_user = userId;
    if (updateZoneDto.id_site && updateZoneDto.id_site !== siteId && userRole !== Role.SUPERADMIN) {
      throw new ForbiddenException('You cannot update a zone from another site');
    }
    const response = await this.zoneService.update(id, updateZoneDto, siteId, userRole);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if (response['status'] === 403) {
      throw new ForbiddenException(response['message']);
    } else if (response['status'] === 409) {
      // Zona duplicada (mismo número + sede/subsede), detectada en ZoneService.update
      throw new ConflictException(response['message']);
    }
    return response;
  }

  
  @Delete(':id')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') userRole: Role,
  ) {
    const response = await this.zoneService.remove(id, siteId, userRole);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if (response['status'] === 403) {
      throw new ForbiddenException(response['message']);
    }
    return response;
  }
}
