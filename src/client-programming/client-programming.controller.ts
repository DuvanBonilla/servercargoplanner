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
  ConflictException,
  Query,
  UseInterceptors,
  ForbiddenException,
} from '@nestjs/common';
import { ClientProgrammingService } from './client-programming.service';
import { CreateClientProgrammingDto } from './dto/create-client-programming.dto';
import { UpdateClientProgrammingDto } from './dto/update-client-programming.dto';
import { ParseIntPipe } from 'src/pipes/parse-int/parse-int.pipe';
import { DateTransformPipe } from 'src/pipes/date-transform/date-transform.pipe';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { FilterClientProgrammingDto } from './dto/filter-client-programming.dto';
import { SiteInterceptor } from 'src/common/interceptors/site.interceptor';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { RolesGuard } from 'src/auth/guards/roles.guard';

@Controller('client-programming')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(SiteInterceptor)
@Roles(Role.SUPERADMIN, Role.ADMIN, Role.SUPERVISOR)
@ApiBearerAuth('access-token')
export class ClientProgrammingController {
  constructor(
    private readonly clientProgrammingService: ClientProgrammingService,
  ) {}

  @Post()
  @UsePipes(new DateTransformPipe())
  async create(
    @Body() createClientProgrammingDto: CreateClientProgrammingDto,
    @CurrentUser('userId') userId: number,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('subsiteId') subsiteId: number,
  ) {
    createClientProgrammingDto.id_user = userId;
    // Usar los valores del usuario si no se proporciona explícitamente
    if (
      createClientProgrammingDto.id_site === null ||
      createClientProgrammingDto.id_site === undefined
    ) {
      createClientProgrammingDto.id_site = siteId;
    }
    if (
      createClientProgrammingDto.id_subsite === null ||
      createClientProgrammingDto.id_subsite === undefined
    ) {
      createClientProgrammingDto.id_subsite = subsiteId;
    }
    // Validar que el usuario tenga permiso en ese site
    if (siteId !== null && siteId !== undefined && createClientProgrammingDto.id_site !== siteId) {
      throw new ForbiddenException(
        'No tienes permiso para crear una programación en este sitio',
      );
    }
    const response = await this.clientProgrammingService.create(
      createClientProgrammingDto,
    );
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if (response['status'] === 409) {
      throw new ConflictException(response['message']);
    }
    return response;
  }

  @Get('filtered')
  @UsePipes(new DateTransformPipe())
  @ApiOperation({ summary: 'Obtener programaciones de cliente con filtros' })
  async findAllFiltered(
    @Query() filters: FilterClientProgrammingDto,
    @CurrentUser('siteId') siteId: number,
  ) {
    const response = await this.clientProgrammingService.findAllFiltered(
      filters,
      siteId,
    );
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    return response;
  }

  @Get()
  async findAll(@CurrentUser('siteId') siteId: number) {
    const response = await this.clientProgrammingService.findAll(siteId);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    return response;
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('siteId') siteId: number,
  ) {
    const response = await this.clientProgrammingService.findOne(id, siteId);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if (response['status'] === 403) {
      throw new ForbiddenException(response['message']);
    }
    return response;
  }

 @Patch(':id')
@UsePipes(new DateTransformPipe())
async update(
  @Param('id', ParseIntPipe) id: number,
  @Body() updateClientProgrammingDto: UpdateClientProgrammingDto,
  @CurrentUser('siteId') siteId: number,
  @CurrentUser('role') role: string,
) {
  // Validar que el usuario tenga permiso en ese site (solo ADMIN/SUPERVISOR)
  if (role !== 'SUPERADMIN' && siteId !== null && siteId !== undefined) {
    if (
      updateClientProgrammingDto.id_site !== null &&
      updateClientProgrammingDto.id_site !== undefined &&
      updateClientProgrammingDto.id_site !== siteId
    ) {
      throw new ForbiddenException(
        'No tienes permiso para actualizar una programación en este sitio',
      );
    }
  }
  const response = await this.clientProgrammingService.update(
    id,
    updateClientProgrammingDto,
  );
  if (response['status'] === 404) {
    throw new NotFoundException(response['message']);
  }
  return response;
}

  @Delete(':id')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('siteId') siteId: number,
  ) {
    const response = await this.clientProgrammingService.remove(id, siteId);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if (response['status'] === 403) {
      throw new ForbiddenException(response['message']);
    }
    return response;
  }
}
