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
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { TariffService } from './tariff.service';
import { CreateTariffDto } from './dto/create-tariff.dto';
import { UpdateTariffDto } from './dto/update-tariff.dto';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { SiteInterceptor } from 'src/common/interceptors/site.interceptor';
import { ParseIntPipe } from 'src/pipes/parse-int/parse-int.pipe';

@Controller('tariff')
@UseInterceptors(SiteInterceptor)
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPERADMIN, Role.ADMIN, Role.SUPERVISOR, Role.PROGRAMMER)
@ApiBearerAuth('access-token')
export class TariffController {
  constructor(private readonly tariffService: TariffService) {}

  @Post()
  async create(
    @Body() createTariffDto: CreateTariffDto,
    @CurrentUser('userId') userId: number,
  ) {
    createTariffDto.id_user = userId;
    const response = await this.tariffService.create(createTariffDto);
    if (response['status'] === 409) {
      throw new ConflictException(response['message']);
    } else if (response['status'] === 400) {
      throw new BadRequestException(response['message']);
    } else if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    return response;
  }

  @Get()
async findAll(
  @CurrentUser('siteId') siteId: number,
  @CurrentUser('subsiteId') subsiteId: number | null,
) {
  const response = await this.tariffService.findAll(siteId, subsiteId);
  if (response['status'] === 404) {
    throw new NotFoundException(response['message']);
  }
  return response;
}
  
  @Get(':id')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
  ) {
    const response = await this.tariffService.findOne(id);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    return response;
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateTariffDto: UpdateTariffDto,
    @CurrentUser('siteId') siteId: number,
  ) {
    const response = await this.tariffService.update(
      id,
      updateTariffDto,
      siteId
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
    const response = await this.tariffService.remove(id, siteId);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    return response;
  }
}
