import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { SubtaskService } from './subtask.service';
import { CreateSubtaskDto } from './dto/create-subtask.dto';
import { UpdateSubtaskDto } from './dto/update-subtask.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ParseIntPipe } from 'src/pipes/parse-int/parse-int.pipe';
import { ApiBearerAuth } from '@nestjs/swagger';

@Controller('subtask')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPERADMIN, Role.ADMIN)
export class SubtaskController {
  constructor(private readonly subtaskService: SubtaskService) {}

  // @Post()
  // async create(
  //   @Body() createSubtaskDto: CreateSubtaskDto,
  //   @CurrentUser('siteId') siteId: number,
  // ) {
  //   const response = await this.subtaskService.create(createSubtaskDto, siteId);
  //   if (response['status'] === 403) {
  //     throw new ForbiddenException(
  //       'Forbidden: Task does not belong to this site',
  //     );
  //   }else if (response['status'] === 409) {
  //     throw new ConflictException(response['message']);
  //   }
  //   return response;
  // }

@Post()
@Post()
async create(
  @Body() createSubtaskDto: CreateSubtaskDto,
  @CurrentUser('siteId') siteId: number,
  @CurrentUser('subsiteId') subsiteId: number,
) {
  // Solo asigna si no viene en el DTO
  if (
    typeof createSubtaskDto.id_subsite === 'undefined' ||
    createSubtaskDto.id_subsite === null
  ) {
    createSubtaskDto.id_subsite = subsiteId;
  }

  const response = await this.subtaskService.create(createSubtaskDto, siteId);
  if (response['status'] === 403) {
    throw new ForbiddenException(
      'Forbidden: Task does not belong to this site',
    );
  } else if (response['status'] === 409) {
    throw new ConflictException(response['message']);
  }
  return response;
}

  // Lectura abierta al SUPERVISOR: necesita los subservicios al crear/editar operaciones
  @Get()
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.SUPERVISOR)
  async findAll(
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('isSuperAdmin') isSuperAdmin: boolean,
     @CurrentUser('subsiteId') subsiteId: number,
  ) {
    const response = await this.subtaskService.findAll(
      siteId,
      subsiteId,
    );
    if (response['status'] === 404) {
      throw new NotFoundException('No subtasks found');
    }
    return response;
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('isSuperAdmin') isSuperAdmin: boolean,
  ) {
    const response = await this.subtaskService.findOne(
      id,
      !isSuperAdmin ? siteId : undefined,
    );
    if (response['status'] === 404) {
      throw new NotFoundException('Subtask not found');
    }
    return response;
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateSubtaskDto: UpdateSubtaskDto,
    @CurrentUser('siteId') siteId: number,
  ) {
    const response = await this.subtaskService.update(
      id,
      updateSubtaskDto,
      siteId,
    );
    if (response['status'] === 403) {
      throw new ForbiddenException(
        'Forbidden: Task does not belong to this site',
      );
    }
    return response;
  }

  @Delete(':id')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('isSuperAdmin') isSuperAdmin: boolean,
  ) {
    const response = await this.subtaskService.remove(
      id,
      !isSuperAdmin ? siteId : undefined,
    );
    if (response['status'] === 404) {
      throw new NotFoundException('Subtask not found');
    }
    return response;
  }
}
