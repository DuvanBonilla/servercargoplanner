import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, UseInterceptors } from '@nestjs/common';
import { ClientEmailService } from './client-email.service';
import { CreateClientEmailDto } from './dto/create-client-email.dto';
import { UpdateClientEmailDto } from './dto/update-client-email.dto';
import { ParseIntPipe } from 'src/pipes/parse-int/parse-int.pipe';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { UpdateClientEmailStatusDto } from './dto/deactiveStatus-client-email.dto';
import { SiteInterceptor } from 'src/common/interceptors/site.interceptor';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { ApiBearerAuth } from '@nestjs/swagger';

@Controller('client-email')
@UseInterceptors(SiteInterceptor)
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPERADMIN, Role.ADMIN)
@ApiBearerAuth('access-token')
export class ClientEmailController {
  constructor(private readonly clientEmailService: ClientEmailService) {}

 @Post()
  create(@Body() dto: CreateClientEmailDto) {
    return this.clientEmailService.create(dto);
  }

  @Get('client/:idClient')
  findByClient(@Param('idClient', ParseIntPipe) idClient: number) {
    return this.clientEmailService.findByClient(idClient);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.clientEmailService.findOne(id);
  }

    @Get()
    @Roles(Role.SUPERVISOR,Role.PROGRAMMER, Role.ADMIN, Role.SUPERADMIN)
    async findAll() {
      const response = await this.clientEmailService.findAll();
      return response;
    }
  @Patch(':id/status')
updateStatus(
  @Param('id', ParseIntPipe) id: number,
  @Body() dto: UpdateClientEmailStatusDto,
) {
  return this.clientEmailService.updateStatus(id, dto);
}

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateClientEmailDto,
  ) {
    return this.clientEmailService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.clientEmailService.remove(id);
  }
}
