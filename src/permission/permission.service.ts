import { Injectable } from '@nestjs/common';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { ValidationService } from 'src/common/validation/validation.service';
import { ca } from 'date-fns/locale';
import { FilterPermissionDto } from './dto/filter-permission.dto';
import { getColombianDateTime } from 'src/common/utils/dateColombia';

@Injectable()
export class PermissionService {
  constructor(
    private prisma: PrismaService,
    private validate: ValidationService,
  ) {}

  /**
   * Normaliza las fechas YYYY-MM-DD a DateTime (@db.Date) usando UTC
   */
  private normalizeDateFields(data: any) {
    const normalized = { ...data };
    
    // Convertir solo la fecha a DateTime (@db.Date) usando UTC
    if (normalized.dateDisableStart && typeof normalized.dateDisableStart === 'string') {
      if (normalized.dateDisableStart.length === 10) {
        const [year, month, day] = normalized.dateDisableStart.split('-').map(Number);
        // Usar UTC para evitar problemas de timezone
        normalized.dateDisableStart = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
      }
    }
    
    if (normalized.dateDisableEnd && typeof normalized.dateDisableEnd === 'string') {
      if (normalized.dateDisableEnd.length === 10) {
        const [year, month, day] = normalized.dateDisableEnd.split('-').map(Number);
        // Usar UTC para evitar problemas de timezone
        normalized.dateDisableEnd = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
      }
    }
    
    return normalized;
  }

  /**
   * Compara si un permiso está vigente considerando fecha + hora EN ZONA COLOMBIA
   * VIGENTE = AHORA (Colombia time) está entre dateDisableStart+timeStart y dateDisableEnd+timeEnd (inclusive)
   */
  private isPermissionActive(permission: any): boolean {
    const now = getColombianDateTime(); // NOW en zona Colombia
    
    // Extraer YYYY-MM-DD de las fechas
    let startY: number, startM: number, startD: number;
    let endY: number, endM: number, endD: number;

    try {
      let startDateStr: string;
      if (permission.dateDisableStart instanceof Date) {
        startDateStr = permission.dateDisableStart.toISOString().slice(0, 10);
      } else {
        startDateStr = String(permission.dateDisableStart).slice(0, 10);
      }
      const startParts = startDateStr.split('-').map(Number);
      startY = startParts[0];
      startM = startParts[1];
      startD = startParts[2];

      let endDateStr: string;
      if (permission.dateDisableEnd instanceof Date) {
        endDateStr = permission.dateDisableEnd.toISOString().slice(0, 10);
      } else {
        endDateStr = String(permission.dateDisableEnd).slice(0, 10);
      }
      const endParts = endDateStr.split('-').map(Number);
      endY = endParts[0];
      endM = endParts[1];
      endD = endParts[2];
    } catch (err) {
      console.error(`[PermissionService] Error parsing dates:`, err);
      return false;
    }

    // Construir el datetime de INICIO usando el MISMO método que getColombianDateTime()
    const timeStartStr = permission.timeStart || '00:00';
    const [hhStart, mmStart] = timeStartStr.split(':').map(Number);
    
    const tempStartDateTime = new Date(startY, startM - 1, startD, hhStart, mmStart, 0, 0);
    const startDateTime = new Date(
      tempStartDateTime.toLocaleString('en-US', { timeZone: 'America/Bogota' }),
    );

    // Construir el datetime de FIN usando el MISMO método
    const timeEndStr = permission.timeEnd || '23:59';
    const [hhEnd, mmEnd] = timeEndStr.split(':').map(Number);
    
    const tempEndDateTime = new Date(endY, endM - 1, endD, hhEnd, mmEnd, 59, 999);
    const endDateTime = new Date(
      tempEndDateTime.toLocaleString('en-US', { timeZone: 'America/Bogota' }),
    );

    // VIGENTE si: inicio <= ahora <= fin (todos en zona Colombia)
    const isActive = startDateTime <= now && now <= endDateTime;
    
    // Debug
    console.log(`[PermissionService] DEBUG isPermissionActive:`);
    console.log(`  - Inicio: ${startDateTime.toLocaleString('sv-SE')} (Colombia)`);
    console.log(`  - Fin: ${endDateTime.toLocaleString('sv-SE')} (Colombia)`);
    console.log(`  - Ahora: ${now.toLocaleString('sv-SE')} (Colombia)`);
    console.log(`  - ¿${startDateTime.toLocaleString('sv-SE')} <= ${now.toLocaleString('sv-SE')} <= ${endDateTime.toLocaleString('sv-SE')}? ${isActive}`);
    
    return isActive;
  }

  async create(createPermissionDto: CreatePermissionDto, id_site?: number, userRole: string = 'ADMIN') {
  try {
    console.log(`[PermissionService] 🔐 Creando permiso - Rol: ${userRole}, Site: ${id_site}`);
    
    const validation = await this.validate.validateAllIds({
      workerIds: [createPermissionDto.id_worker],
    });
    if (validation && 'status' in validation && validation.status === 404) {
      return validation;
    }
    
    // ✅ VALIDACIÓN DE ACCESO BASADA EN ROL
    const workerValidation = validation?.existingWorkers?.[0];
    if (userRole !== 'SUPERADMIN' && id_site !== undefined && workerValidation && workerValidation.id_site !== id_site) {
      console.log(`[PermissionService] ❌ ADMIN intenta crear permiso para worker de otro site`);
      return {
        message: 'Not authorized to create permission for this worker',
        status: 403,
      };
    }

    // Normalizar las fechas antes de crear
    const normalizedData = this.normalizeDateFields(createPermissionDto);

    // Crear el permiso
    const response = await this.prisma.permission.create({
      data: normalizedData,
    });

    // Verificar si el permiso está vigente AHORA
    const isPermissionVigent = this.isPermissionActive(response);
    
    // console.log(`[PermissionService] CREATE: Permiso ${response.id} - ¿Vigente AHORA? ${isPermissionVigent}`);

    if (isPermissionVigent) {
      console.log(`[PermissionService] CREATE: Permiso VIGENTE AHORA - Cambiando worker ${createPermissionDto.id_worker} a PERMISSION`);
      try {
        const updatedWorker = await this.prisma.worker.update({
          where: { id: createPermissionDto.id_worker },
          data: { status: 'PERMISSION' },
        });
        console.log(`[PermissionService] CREATE: Worker actualizado exitosamente - nuevo status: ${updatedWorker.status}`);
      } catch (error) {
        console.error(`[PermissionService] CREATE: ERROR al actualizar worker - ${error}`);
        throw error;
      }
    } else {
      console.log(`[PermissionService] CREATE: Permiso NO vigente AHORA - NO se cambiará el estado del worker`);
    }

    return response;
  } catch (error) {
    throw new Error(`Error creating permission: ${error}`);
  }
}

  async findByFilters(filters: FilterPermissionDto) {
    try {
      const validation = await this.validate.validateAllIds({
        workerIds: filters.id_worker ? [filters.id_worker] : [],
      });
      if (validation && 'status' in validation && validation.status === 404) {
        return validation;
      }
      const where: any = {};

      if (filters) {
        if (filters.id_worker) {
          where.id_worker = filters.id_worker;
        }
        if (filters.id_site) {
          where.worker = { id_site: filters.id_site };
        }
        if (filters.dateDisableEnd || filters.dateDisableStart) {
          if (filters.dateDisableEnd) {
            where.dateDisableEnd = filters.dateDisableEnd;
          }
          if (filters.dateDisableStart) {
            where.dateDisableStart = filters.dateDisableStart;
          }
        }
      }
      const response = await this.prisma.permission.findMany({
        where,
        include: {
          worker: {
            select: {
              name: true,
            },
          },
          user: {
            select: {
              name: true,
            },
          },
        },
        orderBy: {
          dateDisableStart: 'desc',
        },
      });

      if (!response || response.length === 0) {
        return { status: 404, message: 'No permisssions found' };
      }
      return response;
    } catch (error) {
      throw new Error(`Error finding permissions by filters: ${error}`);
    }
  }

  async findAll(id_site?: number, userRole: string = 'ADMIN') {
    try {
      // Ambos usan el siteId del request
      // SUPERADMIN puede cambiar de site dinámicamente
      // ADMIN solo ve su site fijo
      const response = await this.prisma.permission.findMany({
        where: {
          worker: { id_site },
        },
        include: {
          worker: {
            select: {
              name: true,
            },
          },
          user: {
            select: {
              name: true,
            },
          },
        },
      });
      if (!response || response.length === 0) {
        return { status: 404, message: 'No permissions found' };
      }
      return response;
    } catch (error) {
      throw new Error(`Error finding all permissions: ${error}`);
    }
  }

  async findOne(id: number, id_site?: number, userRole: string = 'ADMIN') {
    try {
      const response = await this.prisma.permission.findUnique({
        where: { id },
        include: {
          worker: {
            select: {
              name: true,
              id_site: true,
            },
          },
          user: {
            select: {
              name: true,
            },
          },
        },
      });
      if (!response) {
        return { status: 404, message: `Permission with id ${id} not found` };
      }
      
      // Validar que el permiso pertenece a esta site
      if (id_site !== undefined && response.worker?.id_site !== id_site) {
        return { status: 404, message: `Permission with id ${id} not found` };
      }
      
      return response;
    } catch (error) {
      throw new Error(`Error finding permission with id ${id}: ${error}`);
    }
  }

  async update(
    id: number,
    updatePermissionDto: UpdatePermissionDto,
    id_site?: number,
    userRole: string = 'ADMIN',
  ) {
    try {
      console.log(`[PermissionService] 🔐 Actualizando permiso ${id} - Rol: ${userRole}, Site: ${id_site}`);
      
      const validation = await this.findOne(id, id_site, userRole);
      if (validation['status'] != undefined) {
        return validation;
      }
      
      // ✅ VALIDACIÓN DE ACCESO BASADA EN ROL
      const workerValidation = await this.validate.validateAllIds({
        workerIds: [validation['id_worker']],
      });
      if (workerValidation && 'status' in workerValidation && workerValidation.status === 404) {
        return workerValidation;
      }
      const validatedWorker = workerValidation?.existingWorkers?.[0];
      if (userRole !== 'SUPERADMIN' && id_site !== undefined && validatedWorker && validatedWorker.id_site !== id_site) {
        console.log(`[PermissionService] ❌ ADMIN intenta actualizar permiso de otro site`);
        return {
          message: 'Not authorized to update permission for this worker',
          status: 403,
        };
      }

      const workerId = validation['id_worker'];
      
      // Normalizar las fechas antes de enviar a Prisma
      const normalizedData = this.normalizeDateFields(updatePermissionDto);
      
      const response = await this.prisma.permission.update({
        where: { id },
        data: normalizedData,
      });

      // Obtener el permiso COMPLETO después de actualizar
      const updatedPermissionFull = await this.prisma.permission.findUnique({
        where: { id },
      });

      // Verificar si el permiso está vigente AHORA
      const isPermissionVigent = this.isPermissionActive(updatedPermissionFull);
      
      // console.log(`[PermissionService] UPDATE: Permiso ${id} - ¿Vigente AHORA? ${isPermissionVigent}`);

      if (isPermissionVigent) {
        // console.log(`[PermissionService] UPDATE: Permiso VIGENTE AHORA - Cambiando worker ${workerId} a PERMISSION`);
        try {
          const updatedWorker = await this.prisma.worker.update({
            where: { id: workerId },
            data: { status: 'PERMISSION' },
          });
          console.log(`[PermissionService] UPDATE: Worker actualizado exitosamente - nuevo status: ${updatedWorker.status}`);
        } catch (error) {
          console.error(`[PermissionService] UPDATE: ERROR al actualizar worker - ${error}`);
          throw error;
        }
      } else {
        console.log(`[PermissionService] UPDATE: Permiso NO vigente AHORA - Cambiar worker a AVALIABLE`);
        try {
          const updatedWorker = await this.prisma.worker.update({
            where: { id: workerId },
            data: { status: 'AVALIABLE' },
          });
          console.log(`[PermissionService] UPDATE: Worker actualizado exitosamente - nuevo status: ${updatedWorker.status}`);
        } catch (error) {
          console.error(`[PermissionService] UPDATE: ERROR al actualizar worker - ${error}`);
          throw error;
        }
      }

      return response;
    } catch (error) {
      throw new Error(`Error updating permission with id ${id}: ${error}`);
    }
  }

  async remove(id: number, id_site?: number, userRole: string = 'ADMIN') {
    try {
      console.log(`[PermissionService] 🔐 Eliminando permiso ${id} - Rol: ${userRole}, Site: ${id_site}`);
      
      const validation = await this.findOne(id, id_site, userRole);
      if (validation['status'] != undefined) {
        return validation;
      }
      
      // ✅ VALIDACIÓN DE ACCESO BASADA EN ROL
      const workerValidation = await this.validate.validateAllIds({
        workerIds: [validation['id_worker']],
      });
      if (workerValidation && 'status' in workerValidation && workerValidation.status === 404) {
        return workerValidation;
      }
      const validatedWorker = workerValidation?.existingWorkers?.[0];
      if (userRole !== 'SUPERADMIN' && id_site !== undefined && validatedWorker && validatedWorker.id_site !== id_site) {
        console.log(`[PermissionService] ❌ ADMIN intenta eliminar permiso de otro site`);
        return {
          message: 'Not authorized to remove permission for this worker',
          status: 403,
        };
      }

      const workerId = validation['id_worker'];
      
      const response = await this.prisma.permission.delete({
        where: { id },
      });

      // Actualizar el estado del trabajador basándose en permisos vigentes
      const allPermissions = await this.prisma.permission.findMany({
        where: { id_worker: workerId },
      });

      // console.log(`[PermissionService] REMOVE: Verificando si hay permisos vigentes para worker ${workerId}`);
      // console.log(`[PermissionService] REMOVE: Total permisos en BD: ${allPermissions.length}`);

      // Buscar si hay ALGÚN permiso vigente AHORA
      const hasActivePermissions = allPermissions.some(p => {
        const isActive = this.isPermissionActive(p);
        // console.log(`[PermissionService] REMOVE: Permiso ${p.id} - ¿Vigente AHORA? ${isActive}`);
        return isActive;
      });

      // console.log(`[PermissionService] REMOVE: ¿Hay permisos vigentes? ${hasActivePermissions}`);

      if (hasActivePermissions) {
        // console.log(`[PermissionService] REMOVE: SÍ hay permisos vigentes - Mantener worker ${workerId} en PERMISSION`);
        try {
          const updatedWorker = await this.prisma.worker.update({
            where: { id: workerId },
            data: { status: 'PERMISSION' },
          });
          // console.log(`[PermissionService] REMOVE: Worker actualizado exitosamente - status: ${updatedWorker.status}`);
        } catch (error) {
          console.error(`[PermissionService] REMOVE: ERROR al actualizar worker - ${error}`);
          throw error;
        }
      } else {
        // console.log(`[PermissionService] REMOVE: NO hay permisos vigentes - Cambiar worker ${workerId} a AVALIABLE`);
        try {
          const updatedWorker = await this.prisma.worker.update({
            where: { id: workerId },
            data: { status: 'AVALIABLE' },
          });
          // console.log(`[PermissionService] REMOVE: Worker actualizado exitosamente - status: ${updatedWorker.status}`);
        } catch (error) {
          console.error(`[PermissionService] REMOVE: ERROR al actualizar worker - ${error}`);
          throw error;
        }
      }

      return response;
    } catch (error) {
      throw new Error(`Error removing permission with id ${id}: ${error}`);
    }
  }
}
