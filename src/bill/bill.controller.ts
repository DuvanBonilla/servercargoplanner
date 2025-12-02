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
  ConflictException,
} from '@nestjs/common';
import { BillService } from './bill.service';
import { CreateBillDto } from './dto/create-bill.dto';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { SiteInterceptor } from 'src/common/interceptors/site.interceptor';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { ParseIntPipe } from 'src/pipes/parse-int/parse-int.pipe';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { UpdateBillDto, UpdateBillStatusDto } from './dto/update-bill.dto';

@Controller('bill')
@UseInterceptors(SiteInterceptor)
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPERVISOR, Role.ADMIN, Role.SUPERADMIN)
@ApiBearerAuth('access-token')
export class BillController {
  constructor(private readonly billService: BillService) {}

  @Post()
  async create(
    @CurrentUser('userId') userId: number,
    @Body() createBillDto: CreateBillDto) {
      // Agrega este console.log para ver lo que llega del frontend
  console.log('=== Datos recibidos para crear factura ===');
  console.log(JSON.stringify(createBillDto, null, 2));
  console.log('==========================================');
    const response = await this.billService.create(createBillDto, userId);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    if (response['status'] === 409) {
      throw new ConflictException(response['message']);
    }
    return response;
  }

  @Get()
  
  async findAll(
  @CurrentUser('id_site') id_site?: number,
    @CurrentUser('id_subsite') id_subsite?: number | null,

  ) {
    const bills = await this.billService.findAll(id_site, id_subsite);
    return bills;
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
     @CurrentUser('id_site') id_site?: number,
    @CurrentUser('id_subsite') id_subsite?: number | null,

) {
    const bill = await this.billService.findOne(id);
    if (!bill) {
      throw new NotFoundException(`Bill with ID ${id} not found`);
    }
    return bill;
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('userId') userId: number,
    @Body() updateBillDto: UpdateBillDto,
  ) {
    return this.billService.update(id, updateBillDto, userId);
  }
  
  @Patch(':id/status')
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateBillStatusDto: UpdateBillStatusDto,
    @CurrentUser('userId') userId: number,
  ) {
    const response = await this.billService.updateStatus(
      id, 
      updateBillStatusDto.status, 
      userId
    );
    return response;
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.billService.remove(id);
  }
}
