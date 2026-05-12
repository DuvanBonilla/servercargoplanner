import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  UsePipes,
  NotFoundException,
  ConflictException,
  UseInterceptors,
} from '@nestjs/common';
import { TaskService } from './task.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ToLowerCasePipe } from 'src/pipes/to-lowercase/to-lowercase.pipe';
import { ParseIntPipe } from 'src/pipes/parse-int/parse-int.pipe';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { SiteInterceptor } from 'src/common/interceptors/site.interceptor';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { sub } from 'date-fns';

@Controller('task')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPERADMIN, Role.ADMIN)
@UseInterceptors(SiteInterceptor)
@ApiBearerAuth('access-token')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  // @Post()
  // // @UsePipes(new ToLowerCasePipe())
  // async create(
  //   @Body() createTaskDto: CreateTaskDto,
  //   @CurrentUser('userId') userId: number,
  //   @CurrentUser('siteId') siteId: number,
  //   @CurrentUser('subsiteId') subsiteId: number,
  // ) {
  //   if (!createTaskDto.id_site || !createTaskDto.id_subsite) {
  //     createTaskDto.id_site = siteId;
  //     createTaskDto.id_subsite = subsiteId;
  //   }
  //   createTaskDto.id_user = userId;
  //   const response = await this.taskService.create(createTaskDto);
  //   if (response['status'] === 404) {
  //     throw new NotFoundException(response['message']);
  //   }
  //   if (response['status'] === 409) {
  //     throw new ConflictException(response['message']);
  //   }

  //   return response;
  // }

  @Post()
async create(
  @Body() createTaskDto: CreateTaskDto,
  @CurrentUser('userId') userId: number,
  @CurrentUser('siteId') siteId: number,
  @CurrentUser('subsiteId') subsiteId: number,
) {
  // Siempre asigna el siteId del usuario
  createTaskDto.id_site = siteId;
  // Fuerza la subsede a null SIEMPRE
  createTaskDto.id_subsite = null;
  createTaskDto.id_user = userId;

  const response = await this.taskService.create(createTaskDto);
  if (response['status'] === 404) {
    throw new NotFoundException(response['message']);
  }
  if (response['status'] === 409) {
    throw new ConflictException(response['message']);
  }
  return response;
}

  @Get(':id')
  @Roles(Role.SUPERVISOR, Role.ADMIN, Role.SUPERADMIN, Role.PROGRAMMER)
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('siteId') siteId: number,
  ) {
    const response = await this.taskService.findOne(id, siteId);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    return response;
  }

   @Get()
  @Roles(Role.SUPERVISOR, Role.ADMIN, Role.SUPERADMIN, Role.PROGRAMMER)
  async findAll(
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('subsiteId') subsiteId?: number, // Hacer opcional con ?
  ) {
    // Quitar esta validación que hace obligatorio el subsiteId
    // if (!siteId || !subsiteId) {
    //   throw new ConflictException('Site ID and Subsite ID are required');
    // }

    // Solo validar que siteId sea requerido
    if (!siteId) {
      throw new ConflictException('Site ID is required');
    }

    const response = await this.taskService.findAll(siteId, subsiteId);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    return response;
  }

  
  @Get('by-name/:name')
  async findByName(
    @Param('name') name: string,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('subsiteId') subsiteId: number,
  ) {
    const response = await this.taskService.findOneTaskName(name, siteId, subsiteId);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    return response;
  }

 @Patch(':id')
async update(
  @Param('id', ParseIntPipe) id: number,
  @Body() updateTaskDto: UpdateTaskDto,
  @CurrentUser('siteId') siteId: number, // Obtener el siteId del usuario
) {
  const response = await this.taskService.update(id, updateTaskDto, siteId);
  if (response['status'] === 404) {
    throw new NotFoundException(response['message']);
  } else if (response['status'] === 409) {
    throw new ConflictException(response['message']);
  }
  return response;
}

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    const response = await this.taskService.remove(id);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    return response;
  }
}
