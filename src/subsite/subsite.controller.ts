import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseInterceptors,
} from '@nestjs/common';
import { SubsiteService } from './subsite.service';
import { CreateSubsiteDto } from './dto/create-subsite.dto';
import { UpdateSubsiteDto } from './dto/update-subsite.dto';
import { SiteInterceptor } from 'src/common/interceptors/site.interceptor';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { ParseIntPipe } from 'src/pipes/parse-int/parse-int.pipe';
import { ApiBearerAuth } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';

@Controller('subsite')
@UseInterceptors(SiteInterceptor)
@ApiBearerAuth('access-token')
@Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH, Role.SUPERVISOR, Role.PROGRAMMER)
export class SubsiteController {
  constructor(private readonly subsiteService: SubsiteService) {}

  @Post()
  create(
    @Body() createSubsiteDto: CreateSubsiteDto,
    @CurrentUser('siteId') siteId: number,
  ) {
    if (siteId) {
      createSubsiteDto.id_site = siteId;
      if (createSubsiteDto.id_site && createSubsiteDto.id_site !== siteId) {
        throw new Error(
          `You can only create subsites in your site (${siteId})`,
        );
      }
    }
    return this.subsiteService.create(createSubsiteDto);
  }

  @Get()
  async findAll(@CurrentUser('siteId') siteId: number) {
    const response = await this.subsiteService.findAll(siteId);
    if (response['status'] === 404) {
      return { status: 404, message: 'No subsites found' };
    }
    return response;
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('siteId') siteId: number,
  ) {
    const response = await this.subsiteService.findOne(id, siteId);
    if (response['status'] === 404) {
      return { status: 404, message: 'Subsite not found' };
    }
    return response;
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateSubsiteDto: UpdateSubsiteDto,
    @CurrentUser('siteId') siteId: number,
  ) {
    const existingSubsite = await this.subsiteService.findOne(id, siteId);
    if (existingSubsite['status'] === 404) {
      return { status: 404, message: 'Subsite not found' };
    }
    const response = await this.subsiteService.update(
      id,
      updateSubsiteDto,
      siteId,
    );
    return response;
  }

  @Delete(':id')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('siteId') siteId: number,
  ) {
    const existingSubsite = await this.subsiteService.findOne(id, siteId);
    if (existingSubsite['status'] === 404) {
      return { status: 404, message: 'Subsite not found' };
    }
    const response = await this.subsiteService.remove(id, siteId);
    return response;
  }
}
