import { Injectable } from '@nestjs/common';
import { CreateAreaDto } from './dto/create-area.dto';
import { UpdateAreaDto } from './dto/update-area.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { validate } from 'class-validator';
import { Role } from '@prisma/client';

/**
 * Servicio para gestionar areas
 * @class AreaService
 */
@Injectable()
export class AreaService {
  constructor(private prisma: PrismaService) {}

  /**
   * Crear un area
   * @param createAreaDto  Datos del area a crear
   * @param id_site ID de la sede (opcional, para sobreescribir el del DTO)
   * @returns  Area creada o mensaje de error
   */
  async create(createAreaDto: CreateAreaDto, id_site?: number) {
    try {
      if (createAreaDto.id_user === undefined) {
        return { message: 'User ID is required', status: 400 };
      }

      // Eliminar el campo 'id' del DTO para evitar conflictos de unique constraint
      const {...dataWithoutId } = createAreaDto as any;

      const response = await this.prisma.jobArea.create({
        data: {
          ...dataWithoutId,
          id_site: id_site || createAreaDto.id_site,
          id_user: createAreaDto.id_user,
        },
      });
      return response;
    } catch (error) {
      console.error('Error creating area:', error);
      throw new Error(error.message || String(error));
    }
  }

  /**
   * devuelve todas las areas
   * @param id_site ID de la sede
   * @param id_subsite ID de la subsede
   * @param userRole Rol del usuario (para determinar si aplicar filtros)
   * @returns retorna todas las areas
   */
  async findAll(
  id_site?: number,
  id_subsite?: number,
) {
  try {
    const whereClause: any = {};

    // Siempre filtra por sede si viene
    if (id_site) {
      whereClause.id_site = id_site;
    }

    // Solo filtra por subsede si es un número válido (no null, no undefined)
    if (typeof id_subsite === 'number' && !isNaN(id_subsite)) {
      whereClause.id_subsite = id_subsite;
    }
    // Si id_subsite es null o undefined, NO agregar filtro de subsede

    const response = await this.prisma.jobArea.findMany({
      where: whereClause,
      include: {
        Site: {
          select: {
            name: true,
          },
        },
        subSite: {
          select: {
            name: true,
          },
        },
      },
    });

    return response;
  } catch (error) {
    throw new Error(error.message || String(error));
  }
}

  /**
   * Busca un area por su ID
   * @param id  ID del area a buscar
   * @param id_site ID de la sede (opcional para validación)
   * 
   * @param userRole Rol del usuario
   * @returns  Area encontrada o mensaje de error
   */
  async findOne(id: number, id_site?: number, userRole?: Role) {
    try {
      const whereClause: any = { id };

      // Solo aplicar filtro de sede si no es SUPERADMIN
      if (userRole !== Role.SUPERADMIN && id_site !== undefined) {
        whereClause.id_site = id_site;
      }

      const response = await this.prisma.jobArea.findUnique({
        where: whereClause,
        include: {
          Site: {
            select: {
              name: true,
            },
          },
          subSite: {
            select: {
              name: true,
            },
          },
        },
      });

      if (!response) {
        return { message: 'Area not found', status: 404 };
      }
      return response;
    } catch (error) {
      throw new Error(error.message || String(error));
    }
  }

  /**
   * actualiza un area
   * @param id  id del area a actualizar
   * @param updateAreaDto datos del area a actualizar
   * @param id_site ID de la sede actual del usuario (para validación)
   * @param userRole Rol del usuario
   * @returns area actualizada o mensaje de error
   */
  async update(
    id: number,
    updateAreaDto: UpdateAreaDto,
    id_site?: number,
    userRole?: Role,
  ) {
    try {
      // Buscar el área sin restricción de sede para poder validarla
      const validate = await this.findOne(id, undefined, Role.SUPERADMIN || Role.ADMIN);
      if (validate['status'] === 404) {
        return validate;
      }

      // Solo validar autorización si no es SUPERADMIN
      if (userRole !== Role.SUPERADMIN ||  Role.ADMIN) {
        if (id_site !== undefined && validate['id_site'] !== id_site) {
          return { message: 'Not authorized to update this area', status: 403 };
        }
      }

      // Filtrar solo los campos que pueden ser actualizados
      const allowedFields = [
        'name',
        'id_user',
        'status',
        'id_site',
        'id_subsite',
      ];
      const dataToUpdate: any = {};

      for (const [key, value] of Object.entries(updateAreaDto)) {
        if (allowedFields.includes(key)) {
          dataToUpdate[key] = value;
        }
      }

      const response = await this.prisma.jobArea.update({
        where: { id },
        data: dataToUpdate,
        include: {
          Site: {
            select: {
              name: true,
            },
          },
          subSite: {
            select: {
              name: true,
            },
          },
        },
      });
      return response;
    } catch (error) {
      console.error('Error updating area:', error);
      throw new Error(error.message || String(error));
    }
  }

  /**
   * Elimina un area
   * @param id id del area a eliminar
   * @param id_site ID de la sede (para validación)
   * @param userRole Rol del usuario
   * @returns retorna mensaje de exito o error
   */
  async remove(id: number, id_site?: number, userRole?: Role) {
    try {
      const validate = await this.findOne(id, undefined, Role.SUPERADMIN);
      if (validate['status'] === 404) {
        return validate;
      }

      // Solo validar autorización si no es SUPERADMIN
      if (userRole !== Role.SUPERADMIN) {
        if (id_site !== undefined && validate['id_site'] !== id_site) {
          return { message: 'Not authorized to delete this area', status: 403 };
        }
      }

      const response = await this.prisma.jobArea.delete({
        where: { id },
      });
      return response;
    } catch (error) {
      throw new Error(error.message || String(error));
    }
  }
}
