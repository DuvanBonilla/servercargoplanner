import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  UseInterceptors,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { SiteInterceptor } from 'src/common/interceptors/site.interceptor';
import { ParseIntPipe } from 'src/pipes/parse-int/parse-int.pipe';
import { WorkerContractService } from './worker-contract.service';
import { CreateWorkerContractDto } from './dto/create-worker-contract.dto';
import { UpdateWorkerContractDto } from './dto/update-worker-contract.dto';
import {
  ExpiringContractEntity,
  WorkerContractEntity,
} from './entities/worker-contract.entity';

@ApiTags('Worker contracts')
@Controller('worker-contract')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(SiteInterceptor)
@ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
export class WorkerContractController {
  constructor(private readonly workerContractService: WorkerContractService) {}

  private handle(response: any) {
    switch (response?.status) {
      case 400:
        throw new BadRequestException(response.message);
      case 403:
        throw new ForbiddenException(response.message);
      case 404:
        throw new NotFoundException(response.message);
      case 409:
        throw new ConflictException(response.message);
    }
    return response;
  }

  @Post()
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH)
  @ApiOperation({
    summary: 'Create worker contract',
    description:
      'Registers a contract of a worker with a company. startDate and endDate are required and it cannot overlap another contract of the same worker: close the current one first by setting its endDate. ' +
      'If the worker is DEACTIVATED it is reactivated (AVALIABLE); when it has no contract history, its previous retirement is kept as a legacy contract. ' +
      "The worker's dateRetierment is synced with the endDate of the latest contract. Roles: SUPERADMIN, ADMIN, GH.",
  })
  @ApiResponse({ status: 201, description: 'Contract created', type: WorkerContractEntity })
  @ApiResponse({ status: 400, description: 'Invalid data, startDate after endDate or company not ACTIVE' })
  @ApiResponse({ status: 403, description: 'User role is not allowed or worker belongs to another site' })
  @ApiResponse({ status: 404, description: 'Worker or company not found' })
  @ApiResponse({ status: 409, description: 'Overlaps another contract, starts before the retirement date or worker code in use' })
  async create(
    @Body() dto: CreateWorkerContractDto,
    @CurrentUser('userId') userId: number,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
  ) {
    dto.id_user = userId;
    return this.handle(await this.workerContractService.create(dto, siteId, role));
  }

  @Get('expiring')
  @ApiOperation({
    summary: 'List expiring contracts',
    description:
      'Alert list: contracts ending within the next `days` days or already ended, whose worker is not DEACTIVATED and has no later contract. Nothing is deactivated automatically.',
  })
  @ApiQuery({ name: 'days', required: false, type: Number, example: 30, description: 'Days ahead to look (default 30)' })
  @ApiResponse({ status: 200, description: 'Expiring contracts ordered by endDate', type: [ExpiringContractEntity] })
  async findExpiring(
    @Query('days') days: string,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
  ) {
    const parsed = days === undefined ? 30 : Number(days);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new BadRequestException('days must be a non-negative integer');
    }
    return this.workerContractService.findExpiring(parsed, siteId, role);
  }

  @Get('worker/:id_worker')
  @ApiOperation({
    summary: 'List contracts of a worker',
    description: 'Contract history of the worker, most recent first, including company and its current ARL.',
  })
  @ApiParam({ name: 'id_worker', type: Number, example: 128 })
  @ApiResponse({ status: 200, description: 'Contract history', type: [WorkerContractEntity] })
  @ApiResponse({ status: 403, description: 'Worker belongs to another site' })
  @ApiResponse({ status: 404, description: 'Worker not found' })
  async findByWorker(
    @Param('id_worker', ParseIntPipe) id_worker: number,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
  ) {
    return this.handle(await this.workerContractService.findByWorker(id_worker, siteId, role));
  }

  @Get('worker/:id_worker/current')
  @ApiOperation({
    summary: 'Get contract in effect',
    description: 'Contract of the worker in effect on `date` (default: today in Colombia).',
  })
  @ApiParam({ name: 'id_worker', type: Number, example: 128 })
  @ApiQuery({ name: 'date', required: false, type: String, example: '2026-10-23', description: 'YYYY-MM-DD' })
  @ApiResponse({ status: 200, description: 'Contract in effect', type: WorkerContractEntity })
  @ApiResponse({ status: 404, description: 'Worker not found or no contract in effect on that date' })
  async findCurrent(
    @Param('id_worker', ParseIntPipe) id_worker: number,
    @Query('date') date: string,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
  ) {
    if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('date must have the format YYYY-MM-DD');
    }
    return this.handle(await this.workerContractService.findCurrent(id_worker, siteId, role, date));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get worker contract by id' })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiResponse({ status: 200, description: 'Contract found', type: WorkerContractEntity })
  @ApiResponse({ status: 404, description: 'Contract not found' })
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
  ) {
    return this.handle(await this.workerContractService.findOne(id, siteId, role));
  }

  @Patch(':id')
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH)
  @ApiOperation({
    summary: 'Update worker contract',
    description:
      'Updates company, dates or worker type. Setting endDate closes the contract. Also used to complete legacy contracts. Roles: SUPERADMIN, ADMIN, GH.',
  })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiResponse({ status: 200, description: 'Contract updated', type: WorkerContractEntity })
  @ApiResponse({ status: 400, description: 'Invalid data, startDate after endDate or company not ACTIVE' })
  @ApiResponse({ status: 403, description: 'User role is not allowed' })
  @ApiResponse({ status: 404, description: 'Contract or company not found' })
  @ApiResponse({ status: 409, description: 'Overlaps another contract of the worker' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateWorkerContractDto,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
  ) {
    return this.handle(await this.workerContractService.update(id, dto, siteId, role));
  }

  @Delete(':id')
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH)
  @ApiOperation({
    summary: 'Delete worker contract',
    description: 'Deletes a contract registered by mistake. Contracts referenced by inabilities cannot be deleted. Roles: SUPERADMIN, ADMIN, GH.',
  })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiResponse({ status: 200, description: 'Contract deleted', type: WorkerContractEntity })
  @ApiResponse({ status: 403, description: 'User role is not allowed' })
  @ApiResponse({ status: 404, description: 'Contract not found' })
  @ApiResponse({ status: 409, description: 'Contract is referenced by inabilities' })
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
  ) {
    return this.handle(await this.workerContractService.remove(id, siteId, role));
  }
}
