import { Injectable } from '@nestjs/common';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { Role } from '@prisma/client';

/**
 * Servicio para gestionar zonas (CRUD sobre la tabla Zone)
 * @class ZoneService
 */
@Injectable()
export class ZoneService {
  constructor(private prisma: PrismaService) {}

  /**
   * Crea una nueva zona
   * @param createZoneDto Datos de la zona a crear (nombre, sede, subsede, usuario creador)
   * @returns La zona creada, o un mensaje de error si falta el id_user
   */
  async create(createZoneDto: CreateZoneDto) {
    try {
      if (createZoneDto.id_user === undefined) {
        return { message: 'User ID is required', status: 400 };
      }

      // Verificación de duplicados hecha en el backend (no hay constraint en la DB):
      // busca si ya existe una zona con el mismo número en la misma sede/subsede.
      // mode: 'insensitive' para que "Zona 6" y "zona 6" cuenten como la misma zona.
      // Se compara id_subsite directo (incluyendo null) para que dos zonas sin
      // subsede asignada también se consideren duplicadas entre sí.
      const existing = await this.prisma.zone.findFirst({
        where: {
          name: { equals: createZoneDto.name, mode: 'insensitive' },
          id_site: createZoneDto.id_site,
          id_subsite: createZoneDto.id_subsite ?? null,
        },
      });

      if (existing) {
        return {
          message: `Ya existe una zona con el número '${createZoneDto.name}' en esta subsede`,
          status: 409,
        };
      }

      const response = await this.prisma.zone.create({
        data: {
          name: createZoneDto.name,
          id_user: createZoneDto.id_user,
          id_site: createZoneDto.id_site,
          id_subsite: createZoneDto.id_subsite,
        },
      });
      return response;
    } catch (error) {
      console.error('Error creating zone:', error);
      throw new Error(error.message || String(error));
    }
  }

  /**
   * Devuelve todas las zonas, opcionalmente filtradas por sede y/o subsede
   * @param id_site ID de la sede (si se omite, no filtra por sede)
   * @param id_subsite ID de la subsede (si se omite, no filtra por subsede)
   * @returns Listado de zonas con el nombre de su sede/subsede incluido
   */
  async findAll(id_site?: number, id_subsite?: number) {
    try {
      const whereClause: any = {};

      // Solo agrega el filtro de sede si viene un valor
      if (id_site) {
        whereClause.id_site = id_site;
      }

      // Solo agrega el filtro de subsede si es un número válido (evita filtrar por null/undefined)
      if (typeof id_subsite === 'number' && !isNaN(id_subsite)) {
        whereClause.id_subsite = id_subsite;
      }

      const response = await this.prisma.zone.findMany({
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
   * Busca una zona por su ID
   * @param id ID de la zona a buscar
   * @param id_site ID de la sede del usuario (para restringir la búsqueda si no es SUPERADMIN)
   * @param userRole Rol del usuario que consulta (SUPERADMIN no tiene restricción de sede)
   * @returns La zona encontrada, o un mensaje 404 si no existe
   */
  async findOne(id: number, id_site?: number, userRole?: Role) {
    try {
      const whereClause: any = { id };

      // SUPERADMIN puede ver cualquier zona; los demás roles quedan restringidos a su sede
      if (userRole !== Role.SUPERADMIN && id_site !== undefined) {
        whereClause.id_site = id_site;
      }

      const response = await this.prisma.zone.findUnique({
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
        return { message: 'Zone not found', status: 404 };
      }
      return response;
    } catch (error) {
      throw new Error(error.message || String(error));
    }
  }

  /**
   * Actualiza una zona existente (nombre, estado, sede, subsede)
   * @param id ID de la zona a actualizar
   * @param updateZoneDto Campos a actualizar
   * @param id_site ID de la sede del usuario (para validar que no edite zonas de otra sede)
   * @param userRole Rol del usuario (SUPERADMIN se salta la validación de sede)
   * @returns La zona actualizada, o un mensaje de error (404 no existe / 403 sin permiso)
   */
  async update(
    id: number,
    updateZoneDto: UpdateZoneDto,
    id_site?: number,
    userRole?: Role,
  ) {
    try {
      // Primero valida que la zona exista, sin restricción de sede (se necesita comparar después)
      const validate = await this.findOne(id, undefined, Role.SUPERADMIN);
      if (validate['status'] === 404) {
        return validate;
      }

      // Si no es SUPERADMIN, verifica que la zona pertenezca a la sede del usuario
      if (userRole !== Role.SUPERADMIN) {
        if (id_site !== undefined && validate['id_site'] !== id_site) {
          return { message: 'Not authorized to update this zone', status: 403 };
        }
      }

      // Verificación de duplicados (igual que en create, insensible a mayúsculas),
      // solo si el nombre cambia. Se excluye la propia zona (id !== id) para no
      // rechazarla contra sí misma.
      if (updateZoneDto.name) {
        const existing = await this.prisma.zone.findFirst({
          where: {
            id: { not: id },
            name: { equals: updateZoneDto.name, mode: 'insensitive' },
            id_site: validate['id_site'],
            id_subsite: updateZoneDto.id_subsite ?? validate['id_subsite'] ?? null,
          },
        });

        if (existing) {
          return {
            message: `Ya existe una zona con el número '${updateZoneDto.name}' en esta subsede`,
            status: 409,
          };
        }
      }

      // Whitelist de campos editables (evita que se cuele algún campo no permitido en el DTO)
      const allowedFields = ['name', 'id_user', 'status', 'id_site', 'id_subsite'];
      const dataToUpdate: any = {};

      for (const [key, value] of Object.entries(updateZoneDto)) {
        if (allowedFields.includes(key)) {
          dataToUpdate[key] = value;
        }
      }

      const response = await this.prisma.zone.update({
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
      console.error('Error updating zone:', error);
      throw new Error(error.message || String(error));
    }
  }

  /**
   * Elimina (borra en duro) una zona
   * @param id ID de la zona a eliminar
   * @param id_site ID de la sede del usuario (para validar que no borre zonas de otra sede)
   * @param userRole Rol del usuario (SUPERADMIN se salta la validación de sede)
   * @returns La zona eliminada, o un mensaje de error (404 no existe / 403 sin permiso)
   */
  async remove(id: number, id_site?: number, userRole?: Role) {
    try {
      const validate = await this.findOne(id, undefined, Role.SUPERADMIN);
      if (validate['status'] === 404) {
        return validate;
      }

      if (userRole !== Role.SUPERADMIN) {
        if (id_site !== undefined && validate['id_site'] !== id_site) {
          return { message: 'Not authorized to delete this zone', status: 403 };
        }
      }

      const response = await this.prisma.zone.delete({
        where: { id },
      });
      return response;
    } catch (error) {
      throw new Error(error.message || String(error));
    }
  }
}
