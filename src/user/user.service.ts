import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { ValidationService } from '../common/validation/validation.service';
/**
 * Servicio para gestionar usuarios
 * @class UserService
 */
@Injectable()
export class UserService {
  constructor(
    private prisma: PrismaService,
    private validation: ValidationService,
  ) {}
  /**
   * crea un usuario
   * @param createUserDto datos del usuario a crear
   * @returns respuesta de la creacion del usuario
   */
  // async create(createUserDto: CreateUserDto) {
  //   try {
  //     const validationUser = await this.findOne(createUserDto.dni);
  //     const userByUsername = await this.findByUsername(createUserDto.username);
  //     const validate = await this.validation.validateAllIds({
  //       id_subsite: createUserDto.id_subsite,
  //     });
  
  //     if (validate && validate?.subsite?.id_site !== createUserDto.id_site) {
  //       return {
  //         message: 'This subsite does not belong to the site',
  //         status: 409,
  //       };
  //     }
  //     if (validationUser['status'] !== 404 || userByUsername !== null) {
  //       return { message: 'User already DNI/Username exists', status: 409 };
  //     }

  //     const hashedPassword = await bcrypt.hash(createUserDto.password, 10);
  //     const response = await this.prisma.user.create({
  //       data: { ...createUserDto, password: hashedPassword },
  //     });
  //     return response;
  //   } catch (error) {
  //     throw new Error(error);
  //   }
  // }

  async create(createUserDto: CreateUserDto) {
  try {
    // console.log('[UserService] createUserDto recibido:', createUserDto);
    
    const validationUser = await this.findOne(createUserDto.dni);
    const userByUsername = await this.findByUsername(createUserDto.username);
    
    // ✅ SOLO VALIDAR SUBSITE SI SE PROPORCIONA Y NO ES NULL/UNDEFINED
    let validate: { status?: number; [key: string]: any } | null = null;
    if (createUserDto.id_subsite !== undefined && createUserDto.id_subsite !== null) {
      // console.log('[UserService] Validando subsite:', createUserDto.id_subsite);
      
      validate = await this.validation.validateAllIds({
        id_subsite: createUserDto.id_subsite,
      });

     // console.log('[UserService] Resultado validación subsite:', validate);

      // Verificar que la validación no retorne error
      if (validate && 'status' in validate && validate.status !== 200) {
        return validate;
      }

      // Verificar que el subsite pertenezca al site
      if (
        validate &&
        (validate as { Subsite?: { id_site: number } }).Subsite &&
        (validate as { Subsite: { id_site: number } }).Subsite.id_site !== createUserDto.id_site
      ) {
        return {
          message: 'This subsite does not belong to the site',
          status: 409,
        };
      }
    } else {
      console.log('[UserService] id_subsite no proporcionado o es null, omitiendo validación');
    }

    // Validar duplicados
    if (validationUser['status'] !== 404 || userByUsername !== null) {
      return { message: 'User already DNI/Username exists', status: 409 };
    }

    // Crear usuario
    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    const { id_subsites, id_areas, ...fields } = createUserDto;
    const userData = { ...fields, password: hashedPassword };
    if (userData.id_subsite === null || userData.id_subsite === undefined) {
      delete userData.id_subsite;
    }

    const subsiteIds = this.unique(
      id_subsites ?? (fields.id_subsite ? [fields.id_subsite] : []),
    );
    const areaIds = this.unique(id_areas ?? []);
    await this.validateAssignments(subsiteIds, areaIds, fields.id_site);

    if (subsiteIds.length > 0 && !subsiteIds.includes(userData.id_subsite as number)) {
      userData.id_subsite = subsiteIds[0];
    }

    const response = await this.prisma.user.create({
      data: {
        ...userData,
        assignedSubSites: {
          create: subsiteIds.map((id_subsite) => ({ id_subsite })),
        },
        assignedAreas: { create: areaIds.map((id_area) => ({ id_area })) },
      },
      include: this.assignmentInclude,
    });

    return this.toResponse(response);

  } catch (error) {
    if (error instanceof HttpException) throw error;
    console.error('[UserService] Error creando usuario:', error);
    throw new Error(`Error validating IDs: ${error}`);
  }
}

  private readonly assignmentInclude = {
    assignedSubSites: { select: { id_subsite: true } },
    assignedAreas: { select: { id_area: true } },
  } as const;

  private unique(ids: number[]) {
    return [...new Set(ids)];
  }

  private toResponse<
    T extends {
      assignedSubSites: { id_subsite: number }[];
      assignedAreas: { id_area: number }[];
    },
  >(user: T) {
    const { assignedSubSites, assignedAreas, ...rest } = user;
    return {
      ...rest,
      id_subsites: assignedSubSites.map((s) => s.id_subsite),
      id_areas: assignedAreas.map((a) => a.id_area),
    };
  }

  /**
   * Las subsedes deben existir y pertenecer a la sede; cada área debe
   * existir y pertenecer a una de las subsedes seleccionadas.
   */
  private async validateAssignments(
    subsiteIds: number[],
    areaIds: number[],
    id_site?: number | null,
  ) {
    if (subsiteIds.length > 0) {
      const subsites = await this.prisma.subSite.findMany({
        where: { id: { in: subsiteIds } },
        select: { id: true, id_site: true },
      });
      if (subsites.length !== subsiteIds.length) {
        throw new BadRequestException('Alguna subsede asignada no existe');
      }
      if (id_site != null && subsites.some((s) => s.id_site !== id_site)) {
        throw new BadRequestException(
          'Alguna subsede asignada no pertenece a la sede del usuario',
        );
      }
    }
    if (areaIds.length > 0) {
      const areas = await this.prisma.jobArea.findMany({
        where: { id: { in: areaIds } },
        select: { id: true, id_subsite: true },
      });
      if (areas.length !== areaIds.length) {
        throw new BadRequestException('Alguna área asignada no existe');
      }
      if (
        areas.some(
          (a) => a.id_subsite === null || !subsiteIds.includes(a.id_subsite),
        )
      ) {
        throw new BadRequestException(
          'Todas las áreas asignadas deben pertenecer a las subsedes seleccionadas',
        );
      }
    }
  }
  /**
   * obtene todos los usuarios
   * @returns respuesta de la busqueda de todos los usuarios
   */
  async findAll(id_site?: number) {
    try {
      const response = await this.prisma.user.findMany({
        where: { id_site },
        include: this.assignmentInclude,
      });
      return response.map((user) => this.toResponse(user));
    } catch (error) {
      throw new Error(error);
    }
  }
  /**
   * obtener un usuario por su DNI
   * @param dni numero de identificacion del usuario a buscar
   * @returns respuesta de la busqueda del usuario
   */
  async findOne(dni: string, id_site?: number) {
    try {
      const response = await this.prisma.user.findUnique({
        where: {
          dni,
          id_site,
        },
      });
      if (!response) {
        return { message: 'User not found', status: 404 };
      }
      return response;
    } catch (error) {
      throw new Error(error);
    }
  }
  /**
   * obtene un usuario por su ID
   * @param id id del usuario a buscar
   * @returns respuesta de la busqueda del usuario
   */
  async findOneById(id: number) {
    try {
      const response = await this.prisma.user.findUnique({
        where: { id },
      });
      if (!response) {
        return { message: 'User not found', status: 404 };
      }
      return response;
    } catch (error) {
      throw new Error(error);
    }
  }
  /**
   * actualiza un usuario
   * @param dni numero de identificacion del usuario a actualizar
   * @param updateUserDto datos del usuario a actualizar
   * @returns respuesta de la actualizacion del usuario
   */
  async update(dni: string, updateUserDto: UpdateUserDto) {
    try {
      const validateUser = await this.findOne(dni);
      if (validateUser['status'] === 404) {
        return validateUser;
      }
      if (updateUserDto.username) {
        const validateUserByUsername = await this.findByUsername(
          updateUserDto.username,
        );
        if (validateUserByUsername && validateUserByUsername.dni != dni) {
          return { message: 'User already exists', status: 409 };
        }
      }

      const { id_subsites, id_areas, ...dataUpdate } = updateUserDto;
      if (dataUpdate.password) {
        dataUpdate.password = await bcrypt.hash(dataUpdate.password, 10);
      } else {
        delete dataUpdate.password;
      }

      const existing = await this.prisma.user.findUniqueOrThrow({
        where: { dni },
        include: this.assignmentInclude,
      });
      const currentSubsiteIds = existing.assignedSubSites.map((s) => s.id_subsite);
      const idSite = dataUpdate.id_site ?? existing.id_site;

      const newSubsiteIds = id_subsites ? this.unique(id_subsites) : null;
      const newAreaIds = id_areas ? this.unique(id_areas) : null;
      const effectiveSubsiteIds = newSubsiteIds ?? currentSubsiteIds;

      if (newSubsiteIds) {
        await this.validateAssignments(newSubsiteIds, [], idSite);
      }
      if (newAreaIds) {
        await this.validateAssignments(effectiveSubsiteIds, newAreaIds);
      }

      if (newSubsiteIds) {
        const requested = dataUpdate.id_subsite ?? existing.id_subsite;
        (dataUpdate as { id_subsite?: number | null }).id_subsite =
          requested != null && newSubsiteIds.includes(requested)
            ? requested
            : (newSubsiteIds[0] ?? null);
      }

      const response = await this.prisma.$transaction(async (tx) => {
        if (newSubsiteIds) {
          await tx.userSubSite.deleteMany({
            where: { id_user: existing.id, id_subsite: { notIn: newSubsiteIds } },
          });
          await tx.userSubSite.createMany({
            data: newSubsiteIds.map((id_subsite) => ({ id_user: existing.id, id_subsite })),
            skipDuplicates: true,
          });
        } else if (dataUpdate.id_subsite) {
          await tx.userSubSite.createMany({
            data: [{ id_user: existing.id, id_subsite: dataUpdate.id_subsite }],
            skipDuplicates: true,
          });
        }

        if (newAreaIds) {
          await tx.userJobArea.deleteMany({
            where: { id_user: existing.id, id_area: { notIn: newAreaIds } },
          });
          await tx.userJobArea.createMany({
            data: newAreaIds.map((id_area) => ({ id_user: existing.id, id_area })),
            skipDuplicates: true,
          });
        } else if (newSubsiteIds) {
          await tx.userJobArea.deleteMany({
            where: {
              id_user: existing.id,
              area: { id_subsite: { notIn: newSubsiteIds } },
            },
          });
        }

        return tx.user.update({
          where: { dni },
          data: dataUpdate,
          include: this.assignmentInclude,
        });
      });
      return this.toResponse(response);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new Error(error);
    }
  }
  /**
   * eliminar un usuario
   * @param dni numero de identificacion del usuario a eliminar
   * @returns respuesta de la eliminacion del usuario
   */
  async remove(dni: string) {
    try {
      const response = await this.prisma.user.delete({
        where: {
          dni,
        },
      });
      return response;
    } catch (error) {
      throw new Error(error);
    }
  }
  /**
   * obtene un usuario por su nombre de usuario
   * @param username username del usuario a buscar
   * @returns respuesta de la busqueda del usuario
   */
  async findByUsername(username: string) {
      console.log('INICIO findByUsername');
    try {
      const response = await this.prisma.user.findUnique({
        where: {
          username,
        },
        include: {
          Site: {
            select: {
              name: true,
            },
          },
        },
      });
        console.log('FIN findByUsername');
      return response;
    } catch (error) {
      throw new Error(error);
    }
  }
}
