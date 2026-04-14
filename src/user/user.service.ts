import { Injectable } from '@nestjs/common';
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
    
    // ✅ PREPARAR DATOS - ELIMINAR id_subsite SI ES NULL/UNDEFINED
    const userData = { ...createUserDto, password: hashedPassword };
    if (userData.id_subsite === null || userData.id_subsite === undefined) {
      delete userData.id_subsite;
      // console.log('[UserService] id_subsite eliminado del userData (era null/undefined)');
    }

    // console.log('[UserService] userData final para crear:', {
    //   ...userData,
    //   password: '[HIDDEN]' // No mostrar password en logs
    // });

    const response = await this.prisma.user.create({
      data: userData,
    });

    // console.log('[UserService] Usuario creado exitosamente con ID:', response.id);
    return response;

  } catch (error) {
    console.error('[UserService] Error creando usuario:', error);
    throw new Error(`Error validating IDs: ${error}`);
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
      });
      return response;
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

      const dataUpdate = { ...updateUserDto };
      if (dataUpdate.password) {
        dataUpdate.password = await bcrypt.hash(dataUpdate.password, 10);
      } else {
        delete dataUpdate.password;
      }
      const response = await this.prisma.user.update({
        where: {
          dni,
        },
        data: dataUpdate,
      });
      return response;
    } catch (error) {
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
      return response;
    } catch (error) {
      throw new Error(error);
    }
  }
}
