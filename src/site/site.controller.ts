import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ConflictException,
  Request,
  UseGuards,
} from '@nestjs/common';
import { SiteService } from './site.service';
import { CreateSiteDto } from './dto/create-site.dto';
import { UpdateSiteDto } from './dto/update-site.dto';
import { ParseIntPipe } from 'src/pipes/parse-int/parse-int.pipe';
import { ApiBearerAuth } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';

@Controller('site')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('access-token')
export class SiteController {
  constructor(private readonly siteService: SiteService) {}

  @Post()
  @Roles(Role.SUPERADMIN)
  async create(
    @Request() req,
    @Body() createSiteDto: CreateSiteDto,
    @CurrentUser('userId') userId: number,
  ) {
    createSiteDto.id_user = userId;
    const response = await this.siteService.create(createSiteDto);
    if (response.status === 409) {
      throw new ConflictException(response.message);
    }
    return response;
  }

  @Get()
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH, Role.SUPERVISOR, Role.PROGRAMMER)
  async findAll(@CurrentUser('siteId') siteId: number, @CurrentUser('isSuperAdmin') isSuperAdmin: boolean) {
    const response = await this.siteService.findAll(!isSuperAdmin ? siteId : undefined);
    if (response['status'] === 404) {
      return { status: 404, message: 'No sites found' };
    }
    return response;
  }

  @Get(':id')
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH, Role.SUPERVISOR, Role.PROGRAMMER)
  async findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser('siteId') siteId: number) {
    const response = await this.siteService.findOne(id, siteId);
    if (response['status'] === 404) {
      return { status: 404, message: 'Site not found' };
    }
    return response;
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateSiteDto: UpdateSiteDto,
  ) {
    const existingSite = await this.siteService.findOne(id);
    if (existingSite['status'] === 404) {
      return { status: 404, message: 'Site not found' };
    }
    const response = await this.siteService.update(id, updateSiteDto);
    return response;
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    const existingSite = await this.siteService.findOne(id);
    if (existingSite['status'] === 404) {
      return { status: 404, message: 'Site not found' };
    }
    const response = await this.siteService.remove(id);
    return response;
  }
}
