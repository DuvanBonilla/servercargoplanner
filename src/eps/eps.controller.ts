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
  ConflictException,
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
import { Role, StatusActivation } from '@prisma/client';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ParseIntPipe } from 'src/pipes/parse-int/parse-int.pipe';
import { EpsService } from './eps.service';
import { CreateEpsDto } from './dto/create-eps.dto';
import { UpdateEpsDto } from './dto/update-eps.dto';
import { EpsEntity } from './entities/eps.entity';

@ApiTags('EPS')
@Controller('eps')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
export class EpsController {
  constructor(private readonly epsService: EpsService) {}

  @Post()
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH)
  @ApiOperation({
    summary: 'Create EPS',
    description:
      'Creates an EPS. The name is stored in uppercase and the NIT without dots or spaces. Roles: SUPERADMIN, ADMIN, GH.',
  })
  @ApiResponse({ status: 201, description: 'EPS created', type: EpsEntity })
  @ApiResponse({ status: 400, description: 'Invalid data (empty name or malformed NIT)' })
  @ApiResponse({ status: 403, description: 'User role is not allowed' })
  @ApiResponse({ status: 409, description: 'An EPS with that name or NIT already exists' })
  async create(
    @Body() createEpsDto: CreateEpsDto,
    @CurrentUser('userId') userId: number,
  ) {
    createEpsDto.id_user = userId;
    const response = await this.epsService.create(createEpsDto);
    if (response['status'] === 409) {
      throw new ConflictException(response['message']);
    }
    return response;
  }

  @Get()
  @ApiOperation({
    summary: 'List EPS',
    description:
      'Lists EPS ordered by name. Use status=ACTIVE for form selectors. Returns [] when there are no records.',
  })
  @ApiQuery({ name: 'status', required: false, enum: StatusActivation, description: 'Filter by status' })
  @ApiResponse({ status: 200, description: 'EPS list', type: [EpsEntity] })
  async findAll(@Query('status') status?: StatusActivation) {
    return this.epsService.findAll(status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get EPS by id' })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiResponse({ status: 200, description: 'EPS found', type: EpsEntity })
  @ApiResponse({ status: 404, description: 'EPS not found' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const response = await this.epsService.findOne(id);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    return response;
  }

  @Patch(':id')
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH)
  @ApiOperation({
    summary: 'Update EPS',
    description: 'Updates name, NIT or status. To retire an EPS that is in use, set status to INACTIVE. Roles: SUPERADMIN, ADMIN, GH.',
  })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiResponse({ status: 200, description: 'EPS updated', type: EpsEntity })
  @ApiResponse({ status: 403, description: 'User role is not allowed' })
  @ApiResponse({ status: 404, description: 'EPS not found' })
  @ApiResponse({ status: 409, description: 'An EPS with that name or NIT already exists' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateEpsDto: UpdateEpsDto,
  ) {
    const response = await this.epsService.update(id, updateEpsDto);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if (response['status'] === 409) {
      throw new ConflictException(response['message']);
    }
    return response;
  }

  @Delete(':id')
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH)
  @ApiOperation({
    summary: 'Delete EPS',
    description: 'Deletes the EPS if it is not in use; if it is referenced it returns 409 and must be set to INACTIVE. Roles: SUPERADMIN, ADMIN, GH.',
  })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiResponse({ status: 200, description: 'EPS deleted', type: EpsEntity })
  @ApiResponse({ status: 403, description: 'User role is not allowed' })
  @ApiResponse({ status: 404, description: 'EPS not found' })
  @ApiResponse({ status: 409, description: 'EPS in use; set it to INACTIVE' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    const response = await this.epsService.remove(id);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if (response['status'] === 409) {
      throw new ConflictException(response['message']);
    }
    return response;
  }
}
