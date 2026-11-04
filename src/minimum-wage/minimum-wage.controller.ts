import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ParseIntPipe } from 'src/pipes/parse-int/parse-int.pipe';
import { MinimumWageService } from './minimum-wage.service';
import { CreateMinimumWageDto, UpdateMinimumWageDto } from './dto/create-minimum-wage.dto';
import { MinimumWageEntity } from './entities/minimum-wage.entity';

@ApiTags('Minimum wage')
@Controller('minimum-wage')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
export class MinimumWageController {
  constructor(private readonly minimumWageService: MinimumWageService) {}

  private handle(response: any) {
    if (response?.status === 404) throw new NotFoundException(response.message);
    if (response?.status === 409) throw new ConflictException(response.message);
    return response;
  }

  @Post()
  @Roles(Role.SUPERADMIN, Role.ADMIN)
  @ApiOperation({
    summary: 'Create minimum wage for a year',
    description: 'Registers the monthly SMMLV of a year. Previous years are kept as history. Roles: SUPERADMIN, ADMIN.',
  })
  @ApiResponse({ status: 201, description: 'Minimum wage created', type: MinimumWageEntity })
  @ApiResponse({ status: 400, description: 'Invalid year or value' })
  @ApiResponse({ status: 403, description: 'User role is not allowed' })
  @ApiResponse({ status: 409, description: 'The year already has a minimum wage' })
  async create(@Body() dto: CreateMinimumWageDto, @CurrentUser('userId') userId: number) {
    dto.id_user = userId;
    return this.handle(await this.minimumWageService.create(dto));
  }

  @Get()
  @ApiOperation({ summary: 'List minimum wages', description: 'History of the SMMLV by year, most recent first.' })
  @ApiResponse({ status: 200, description: 'Minimum wage history', type: [MinimumWageEntity] })
  async findAll() {
    return this.minimumWageService.findAll();
  }

  @Get('year/:year')
  @ApiOperation({
    summary: 'Get minimum wage of a year',
    description: 'SMMLV of the year and its daily value (value / 30), the minimum IBC for inabilities of that year.',
  })
  @ApiParam({ name: 'year', type: Number, example: 2026 })
  @ApiResponse({ status: 200, description: 'Minimum wage of the year', type: MinimumWageEntity })
  @ApiResponse({ status: 404, description: 'The year has no minimum wage registered' })
  async findByYear(@Param('year', ParseIntPipe) year: number) {
    return this.handle(await this.minimumWageService.findByYear(year));
  }

  @Patch(':id')
  @Roles(Role.SUPERADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Update minimum wage', description: 'Corrects the year or value. Roles: SUPERADMIN, ADMIN.' })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiResponse({ status: 200, description: 'Minimum wage updated', type: MinimumWageEntity })
  @ApiResponse({ status: 403, description: 'User role is not allowed' })
  @ApiResponse({ status: 404, description: 'Minimum wage not found' })
  @ApiResponse({ status: 409, description: 'The year already has a minimum wage' })
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMinimumWageDto) {
    return this.handle(await this.minimumWageService.update(id, dto));
  }

  @Delete(':id')
  @Roles(Role.SUPERADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Delete minimum wage', description: 'Deletes a value registered by mistake. Roles: SUPERADMIN, ADMIN.' })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiResponse({ status: 200, description: 'Minimum wage deleted', type: MinimumWageEntity })
  @ApiResponse({ status: 403, description: 'User role is not allowed' })
  @ApiResponse({ status: 404, description: 'Minimum wage not found' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.handle(await this.minimumWageService.remove(id));
  }
}
