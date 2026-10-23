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
import { ArlService } from './arl.service';
import { CreateArlDto } from './dto/create-arl.dto';
import { UpdateArlDto } from './dto/update-arl.dto';
import { ArlEntity } from './entities/arl.entity';

@ApiTags('ARL')
@Controller('arl')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
export class ArlController {
  constructor(private readonly arlService: ArlService) {}

  @Post()
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH)
  @ApiOperation({
    summary: 'Create ARL',
    description:
      'Creates an ARL. The name is stored in uppercase and the NIT without dots or spaces. Roles: SUPERADMIN, ADMIN, GH.',
  })
  @ApiResponse({ status: 201, description: 'ARL created', type: ArlEntity })
  @ApiResponse({ status: 400, description: 'Invalid data (empty name or malformed NIT)' })
  @ApiResponse({ status: 403, description: 'User role is not allowed' })
  @ApiResponse({ status: 409, description: 'An ARL with that name or NIT already exists' })
  async create(
    @Body() createArlDto: CreateArlDto,
    @CurrentUser('userId') userId: number,
  ) {
    createArlDto.id_user = userId;
    const response = await this.arlService.create(createArlDto);
    if (response['status'] === 409) {
      throw new ConflictException(response['message']);
    }
    return response;
  }

  @Get()
  @ApiOperation({
    summary: 'List ARL',
    description:
      'Lists ARL ordered by name. Use status=ACTIVE for form selectors. Returns [] when there are no records.',
  })
  @ApiQuery({ name: 'status', required: false, enum: StatusActivation, description: 'Filter by status' })
  @ApiResponse({ status: 200, description: 'ARL list', type: [ArlEntity] })
  async findAll(@Query('status') status?: StatusActivation) {
    return this.arlService.findAll(status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get ARL by id' })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiResponse({ status: 200, description: 'ARL found', type: ArlEntity })
  @ApiResponse({ status: 404, description: 'ARL not found' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const response = await this.arlService.findOne(id);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    return response;
  }

  @Patch(':id')
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH)
  @ApiOperation({
    summary: 'Update ARL',
    description: 'Updates name, NIT or status. To retire an ARL that is in use, set status to INACTIVE. Roles: SUPERADMIN, ADMIN, GH.',
  })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiResponse({ status: 200, description: 'ARL updated', type: ArlEntity })
  @ApiResponse({ status: 403, description: 'User role is not allowed' })
  @ApiResponse({ status: 404, description: 'ARL not found' })
  @ApiResponse({ status: 409, description: 'An ARL with that name or NIT already exists' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateArlDto: UpdateArlDto,
  ) {
    const response = await this.arlService.update(id, updateArlDto);
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
    summary: 'Delete ARL',
    description: 'Deletes the ARL if it is not in use; if it is referenced it returns 409 and must be set to INACTIVE. Roles: SUPERADMIN, ADMIN, GH.',
  })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiResponse({ status: 200, description: 'ARL deleted', type: ArlEntity })
  @ApiResponse({ status: 403, description: 'User role is not allowed' })
  @ApiResponse({ status: 404, description: 'ARL not found' })
  @ApiResponse({ status: 409, description: 'ARL in use; set it to INACTIVE' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    const response = await this.arlService.remove(id);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if (response['status'] === 409) {
      throw new ConflictException(response['message']);
    }
    return response;
  }
}
