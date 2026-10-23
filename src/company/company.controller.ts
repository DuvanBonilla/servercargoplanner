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
  BadRequestException,
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
import { CompanyService } from './company.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { CompanyEntity } from './entities/company.entity';

@ApiTags('Companies')
@Controller('company')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Post()
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH)
  @ApiOperation({
    summary: 'Create company',
    description:
      'Creates a company with its current ARL (optional). The name is stored in uppercase and the NIT without dots or spaces. Roles: SUPERADMIN, ADMIN, GH.',
  })
  @ApiResponse({ status: 201, description: 'Company created', type: CompanyEntity })
  @ApiResponse({ status: 400, description: 'Invalid data (empty name, malformed NIT or ARL not ACTIVE)' })
  @ApiResponse({ status: 403, description: 'User role is not allowed' })
  @ApiResponse({ status: 404, description: 'ARL not found' })
  @ApiResponse({ status: 409, description: 'A company with that name or NIT already exists' })
  async create(
    @Body() createCompanyDto: CreateCompanyDto,
    @CurrentUser('userId') userId: number,
  ) {
    createCompanyDto.id_user = userId;
    const response = await this.companyService.create(createCompanyDto);
    if (response['status'] === 400) {
      throw new BadRequestException(response['message']);
    } else if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if (response['status'] === 409) {
      throw new ConflictException(response['message']);
    }
    return response;
  }

  @Get()
  @ApiOperation({
    summary: 'List companies',
    description:
      'Lists companies ordered by name. Use status=ACTIVE for form selectors. Returns [] when there are no records.',
  })
  @ApiQuery({ name: 'status', required: false, enum: StatusActivation, description: 'Filter by status' })
  @ApiResponse({ status: 200, description: 'Company list', type: [CompanyEntity] })
  async findAll(@Query('status') status?: StatusActivation) {
    return this.companyService.findAll(status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get company by id' })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiResponse({ status: 200, description: 'Company found', type: CompanyEntity })
  @ApiResponse({ status: 404, description: 'Company not found' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const response = await this.companyService.findOne(id);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    return response;
  }

  @Patch(':id')
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH)
  @ApiOperation({
    summary: 'Update company',
    description: 'Updates name, NIT, status or current ARL. To retire a company that is in use, set status to INACTIVE. Roles: SUPERADMIN, ADMIN, GH.',
  })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiResponse({ status: 200, description: 'Company updated', type: CompanyEntity })
  @ApiResponse({ status: 400, description: 'Invalid data or ARL not ACTIVE' })
  @ApiResponse({ status: 403, description: 'User role is not allowed' })
  @ApiResponse({ status: 404, description: 'Company or ARL not found' })
  @ApiResponse({ status: 409, description: 'A company with that name or NIT already exists' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateCompanyDto: UpdateCompanyDto,
  ) {
    const response = await this.companyService.update(id, updateCompanyDto);
    if (response['status'] === 400) {
      throw new BadRequestException(response['message']);
    } else if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if (response['status'] === 409) {
      throw new ConflictException(response['message']);
    }
    return response;
  }

  @Delete(':id')
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH)
  @ApiOperation({
    summary: 'Delete company',
    description: 'Deletes the company if it is not in use; if it is referenced it returns 409 and must be set to INACTIVE. Roles: SUPERADMIN, ADMIN, GH.',
  })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiResponse({ status: 200, description: 'Company deleted', type: CompanyEntity })
  @ApiResponse({ status: 403, description: 'User role is not allowed' })
  @ApiResponse({ status: 404, description: 'Company not found' })
  @ApiResponse({ status: 409, description: 'Company in use; set it to INACTIVE' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    const response = await this.companyService.remove(id);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if (response['status'] === 409) {
      throw new ConflictException(response['message']);
    }
    return response;
  }
}
