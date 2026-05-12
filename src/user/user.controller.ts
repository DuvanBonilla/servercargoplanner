import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  NotFoundException,
  ConflictException,
  UseGuards,
  Request,
  ForbiddenException,
  UseInterceptors,
} from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Role } from '@prisma/client';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { SiteInterceptor } from 'src/common/interceptors/site.interceptor';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';

@Controller('user')
@ApiBearerAuth('access-token')
@UseInterceptors(SiteInterceptor)
@UseGuards(JwtAuthGuard, RolesGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  // @Post()
  // @Roles(Role.SUPERADMIN, Role.ADMIN)
  // async create(
  //   @Request() req,
  //   @Body() createUserDto: CreateUserDto,
  //   @CurrentUser('siteId') siteId: number,
  //   @CurrentUser('subsiteId') subsiteId: number,
  // ) {
  //   if(!createUserDto.id_site || !createUserDto.id_subsite){
  //     createUserDto.id_site = siteId;
  //     createUserDto.id_subsite = subsiteId;
  //   }

  //   const currentUserRole = req.user.role;
  //   const newUserRole = createUserDto.role;
  //   if (currentUserRole === Role.ADMIN && newUserRole === Role.SUPERADMIN) {
  //     throw new ForbiddenException('Admins cannot create superadmin accounts');
  //   }

  //   if (currentUserRole === Role.ADMIN && createUserDto.id_site !== siteId) {
  //     throw new ForbiddenException('Not authorized to create user for this site');
  //   }

  //   const response = await this.userService.create(createUserDto);
  //   if (response['status'] === 409) {
  //     throw new ConflictException(response['message']);
  //   }
  //   return response;
  // }

  @Post()
@Roles(Role.SUPERADMIN, Role.ADMIN)
async create(
  @Request() req,
  @Body() createUserDto: CreateUserDto,
  @CurrentUser('siteId') siteId: number,
  @CurrentUser('subsiteId') subsiteId: number,
) {
  // Solo asignar si no viene definido en el DTO o es null/undefined
  if (typeof createUserDto.id_site === 'undefined' || createUserDto.id_site === null) {
    createUserDto.id_site = siteId;
  }
  
  // ✅ SOLO ASIGNAR subsiteId SI NO VIENE EN EL DTO Y EL USUARIO ACTUAL TIENE UNO VÁLIDO
 if (typeof createUserDto.id_subsite === 'undefined' || createUserDto.id_subsite === null) {
  createUserDto.id_subsite = subsiteId;
}

  console.log('[UserController] DTO después de asignaciones:', {
    id_site: createUserDto.id_site,
    id_subsite: createUserDto.id_subsite,
    userCurrentSubsite: subsiteId
  });

  const currentUserRole = req.user.role;
  const newUserRole = createUserDto.role;
  if (currentUserRole === Role.ADMIN && newUserRole === Role.SUPERADMIN) {
    throw new ForbiddenException('Admins cannot create superadmin accounts');
  }

  if (currentUserRole === Role.ADMIN && createUserDto.id_site !== siteId) {
    throw new ForbiddenException('Not authorized to create user for this site');
  }

  const response = await this.userService.create(createUserDto);
  if (response['status'] === 409) {
    throw new ConflictException(response['message']);
  }
  return response;
}

  @Get()
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.SUPERVISOR, Role.PROGRAMMER)
  findAll(
    @CurrentUser('siteId') siteId: number,
  ) {
    return this.userService.findAll(
      siteId 
    );
  }

  @Get(':dni')
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.SUPERVISOR, Role.PROGRAMMER)
  async findOne(
    @Param('dni') dni: string,
    @CurrentUser('siteId') siteId: number,
  ) {
    const response = await this.userService.findOne(
      dni,
      siteId ,
    );
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    return response;
  }

  @Patch(':dni')
  @Roles(Role.SUPERADMIN, Role.ADMIN)
  async update(
    @Request() req,
    @Param('dni') dni: string,
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser('siteId') siteId: number,
  ) {
    const userToUpdate = await this.userService.findOne(dni, siteId);
    const currentUserRole = req.user.role;
    if (userToUpdate['status'] === 404) {
      throw new NotFoundException(userToUpdate['message']);
    }

    if (
      'role' in userToUpdate &&
      currentUserRole === Role.ADMIN &&
      userToUpdate.role === Role.SUPERADMIN
    ) {
      throw new ForbiddenException(
        'Admins cannot update to superadmin accounts',
      );
    }
    const response = await this.userService.update(dni, updateUserDto);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    return response;
  }

  @Delete(':dni')
  @Roles(Role.SUPERADMIN, Role.ADMIN)
  async remove(
    @Request() req,
    @Param('dni') dni: string,
    @CurrentUser('siteId') siteId: number,
  ) {
    const userToDelete = await this.userService.findOne(dni, siteId);
    if (userToDelete['status'] === 404) {
      throw new NotFoundException(userToDelete['message']);
    }
    const currentUserRole = req.user.role;
    if (
      currentUserRole === Role.ADMIN &&
      'role' in userToDelete &&
      userToDelete.role === Role.SUPERADMIN
    ) {
      throw new ForbiddenException('Admins cannot delete superadmin accounts');
    }

    const response = await this.userService.remove(dni);
    return response;
  }
}
