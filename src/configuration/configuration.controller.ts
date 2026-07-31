import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  UseInterceptors,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { ConfigurationService } from './configuration.service';
import { CreateConfigurationDto } from './dto/create-configuration.dto';
import { UpdateConfigurationDto } from './dto/update-configuration.dto';
import { ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { SiteInterceptor } from 'src/common/interceptors/site.interceptor';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ParseIntPipe } from 'src/pipes/parse-int/parse-int.pipe';

@Controller('configuration')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(SiteInterceptor)
@Roles(Role.SUPERADMIN, Role.ADMIN)
@ApiBearerAuth('access-token')
export class ConfigurationController {
  constructor(private readonly configurationService: ConfigurationService) {}

  @Post()
  async create(
    @Body() createConfigurationDto: CreateConfigurationDto,
    @CurrentUser('userId') userId: number,
  ) {
    createConfigurationDto.id_user = userId;
    const response = await this.configurationService.create(
      createConfigurationDto,
    );
    return response;
  }

  @Get()
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.SUPERVISOR, Role.PROGRAMMER, Role.GH)
  async findAll() {
    const response = await this.configurationService.findAll();
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    return response;
  }

  @Get('by-name')
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.SUPERVISOR, Role.PROGRAMMER, Role.GH)
  @ApiQuery({
    name: 'name',
    required: true,
    description: 'Nombre de la configuración a buscar',
  })
  async findByName(@Query('name') name: string) {
    const response = await this.configurationService.findByName(name);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    return response;
  }

  @Get(':id')
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.SUPERVISOR, Role.PROGRAMMER, Role.GH)
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const response = await this.configurationService.findOne(id);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    return response;
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateConfigurationDto: UpdateConfigurationDto,
  ) {
    const response = await this.configurationService.update(
      id,
      updateConfigurationDto,
    );
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    return response;
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    const response = await this.configurationService.remove(id);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    return response;
  }
}
