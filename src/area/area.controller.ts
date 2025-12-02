import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  NotFoundException,
  UseInterceptors,
  ForbiddenException,
  Query
} from '@nestjs/common';
import { AreaService } from './area.service';
import { CreateAreaDto } from './dto/create-area.dto';
import { UpdateAreaDto } from './dto/update-area.dto';
import { ParseIntPipe } from 'src/pipes/parse-int/parse-int.pipe';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { SiteInterceptor } from 'src/common/interceptors/site.interceptor';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from '@prisma/client';

@Controller('area')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPERADMIN, Role.SUPERVISOR, Role.ADMIN)
@ApiBearerAuth('access-token')
@UseInterceptors(SiteInterceptor)
export class AreaController {
  constructor(private readonly areaService: AreaService) {}

  @Post()
  async create(
    @Body() createAreaDto: CreateAreaDto,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('subsiteId') subsiteId: number,

    @CurrentUser('userId') userId: number,
  ) {
    createAreaDto.id_user = userId;
    // createAreaDto.id_subsite = AreaService.subSite;
    // if (!createAreaDto.id_site || !createAreaDto.id_subsite) {
    //   createAreaDto.id_site = siteId;
    //   createAreaDto.id_subsite = subsiteId;
    // }

    if (typeof createAreaDto.id_site === 'undefined' || createAreaDto.id_site === null) {
  createAreaDto.id_site = siteId;
}
if (typeof createAreaDto.id_subsite === 'undefined' || createAreaDto.id_subsite === null) {
  createAreaDto.id_subsite = subsiteId;
}

    const response = await this.areaService.create(createAreaDto);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    return response;
  }

 @Get()
  @Roles(Role.SUPERADMIN, Role.SUPERVISOR, Role.ADMIN, Role.GH)
  @ApiQuery({ 
    name: 'id_subsite', 
    required: false, 
    type: Number,
    description: 'ID de la subsede específica (opcional). GH y SUPERADMIN pueden seleccionar cualquier subsede.'
  })
  async findAll(
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('subsiteId') subsiteId: number,
    @CurrentUser('role') userRole: Role,
    @Query('id_subsite') querySubsiteId?: number,
  ) {
    // Determinar qué subsede usar basado en el rol y parámetros
    let effectiveSubsiteId: number | undefined = subsiteId;
    let effectiveSiteId: number | undefined = siteId;
    
    // Para SUPERADMIN y GH: permitir seleccionar cualquier subsede
    if (userRole === Role.SUPERADMIN || userRole === Role.GH || userRole === Role.SUPERVISOR || userRole === Role.ADMIN) {
      if (querySubsiteId !== undefined && querySubsiteId !== null) {
        // Si especifican una subsede diferente, usarla
        effectiveSubsiteId = querySubsiteId;
        // GH y SUPERADMIN pueden ver cualquier subsede sin restricción de sede
        effectiveSiteId = undefined;
      } else if (userRole === Role.SUPERADMIN || userRole === Role.ADMIN) {
        // SUPERADMIN sin query específica ve todas las áreas
        effectiveSiteId = undefined;
        effectiveSubsiteId = undefined;
      } else if (userRole === Role.SUPERVISOR ) {
        // SUPERVISOR sin query específica mantiene su sede actual pero puede ver todas sus subsedes
        effectiveSiteId = undefined;
        effectiveSubsiteId = undefined;
      }
      // Para GH sin query específica, mantener su subsede actual
    }
    // Para otros roles, mantener restricciones originales (su sede/subsede)
    
    const response = await this.areaService.findAll(effectiveSiteId, effectiveSubsiteId);
    return response;
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('siteId') siteId: number,
    
  ) {
    const response = await this.areaService.findOne(id, siteId);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    return response;
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateAreaDto: UpdateAreaDto,
    @CurrentUser('userId') userId: number,
    @CurrentUser('siteId') siteId: number,
  ) {
    updateAreaDto.id_user = userId;
    if (updateAreaDto.id_site && updateAreaDto.id_site !== siteId) {
      throw new ForbiddenException(
        'You cannot update an area from another site',
      );
    }
    const response = await this.areaService.update(id, updateAreaDto);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if (response['status'] === 403) {
      throw new ForbiddenException(response['message']);
    }
    return response;
  }

  @Delete(':id')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('siteId') siteId: number,
  ) {
    const response = await this.areaService.remove(id, siteId);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if (response['status'] === 403) {
      throw new ForbiddenException(response['message']);
    }
    return response;
  }
}
