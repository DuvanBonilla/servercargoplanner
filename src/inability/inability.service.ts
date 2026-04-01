import { Injectable } from '@nestjs/common';
import { CreateInabilityDto } from './dto/create-inability.dto';
import { UpdateInabilityDto } from './dto/update-inability.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { ValidationService } from 'src/common/validation/validation.service';
import { FilterInabilityDto } from './dto/filter-inability';
import { getColombianDateTime } from 'src/common/utils/dateColombia';

@Injectable()
export class InabilityService {
  constructor(
    private prisma: PrismaService,
    private validate: ValidationService,
  ) {}

  /**
   * Obtiene la fecha de hoy en formato YYYY-MM-DD (UTC)
   */
  private getTodayUTC(): string {
    const now = new Date();
    return now.toISOString().split('T')[0];
  }

  /**
   * Convierte una fecha a string YYYY-MM-DD (UTC)
   */
  private dateToString(date: Date | string): string {
    if (typeof date === 'string') {
      return date;
    }
    return date.toISOString().split('T')[0];
  }

  /**
   * Convierte fechas en formato YYYY-MM-DD a ISO-8601 DateTime válido usando UTC
   */
  private normalizeDateFields(data: any) {
    const normalized = { ...data };
    
    if (normalized.dateDisableStart && typeof normalized.dateDisableStart === 'string') {
      // Si es solo fecha (YYYY-MM-DD), convertir a fecha UTC sin cambios de timezone
      if (normalized.dateDisableStart.length === 10) {
        const [year, month, day] = normalized.dateDisableStart.split('-').map(Number);
        normalized.dateDisableStart = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
      }
    }
    
    if (normalized.dateDisableEnd && typeof normalized.dateDisableEnd === 'string') {
      // Si es solo fecha (YYYY-MM-DD), convertir a fecha UTC sin cambios de timezone
      if (normalized.dateDisableEnd.length === 10) {
        const [year, month, day] = normalized.dateDisableEnd.split('-').map(Number);
        normalized.dateDisableEnd = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
      }
    }
    
    return normalized;
  }

  /**
   * Verifica si una incapacidad es vigente AHORA (la fecha actual está dentro del rango)
   * Para incapacidades, consideramos todo el día como vigente (00:00 a 23:59)
   */
  private isInabilityActive(inability: any): boolean {
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    const startDate = this.dateToString(inability.dateDisableStart);
    const endDate = this.dateToString(inability.dateDisableEnd);

    // Comparar fechas: si hoy está entre inicio y fin (inclusive)
    const isActive = today >= startDate && today <= endDate;

    // console.log(`[InabilityService] DEBUG: Comparando`);
    // console.log(`  - Inicio: ${startDate}`);
    // console.log(`  - Fin: ${endDate}`);
    // console.log(`  - Hoy: ${today}`);
    // console.log(`  - ¿Vigente AHORA? ${isActive}`);

    return isActive;
  }

  /**
   * Verifica si un permiso está vigente considerando fecha + hora EN ZONA COLOMBIA
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
      console.error(`[InabilityService] Error parsing permission dates:`, err);
      return false;
    }

    // Construir el datetime de INICIO
    const timeStartStr = permission.timeStart || '00:00';
    const [hhStart, mmStart] = timeStartStr.split(':').map(Number);
    
    const tempStartDateTime = new Date(startY, startM - 1, startD, hhStart, mmStart, 0, 0);
    const startDateTime = new Date(
      tempStartDateTime.toLocaleString('en-US', { timeZone: 'America/Bogota' }),
    );

    // Construir el datetime de FIN
    const timeEndStr = permission.timeEnd || '23:59';
    const [hhEnd, mmEnd] = timeEndStr.split(':').map(Number);
    
    const tempEndDateTime = new Date(endY, endM - 1, endD, hhEnd, mmEnd, 59, 999);
    const endDateTime = new Date(
      tempEndDateTime.toLocaleString('en-US', { timeZone: 'America/Bogota' }),
    );

    // VIGENTE si: inicio <= ahora <= fin (todos en zona Colombia)
    const isActive = startDateTime <= now && now <= endDateTime;
    
    return isActive;
  }

  async create(createInabilityDto: CreateInabilityDto, id_site?: number, userRole: string = 'ADMIN') {
    try {
      const validation = await this.validate.validateAllIds({
        workerIds: [createInabilityDto.id_worker],
      });
      if (validation && 'status' in validation && validation.status === 404) {
        return validation;
      }
      if (userRole !== 'SUPERADMIN' && id_site !== undefined) {
        const workerValidation = validation?.existingWorkers?.[0];
        if (workerValidation && workerValidation.id_site !== id_site) {
          return {
            message: 'Not authorized to create inability for this worker',
            status: 409,
          };
        }
      }

       // Crear la incapacidad
    const response = await this.prisma.inability.create({
      data: this.normalizeDateFields(createInabilityDto),
    });

    // ÚNICO criterio: verifica si AHORA MISMO está dentro del rango de la incapacidad
    const isInabilityVigent = this.isInabilityActive(response);
    
    // console.log(`[InabilityService] CREATE: Incapacidad ${response.id} - ¿Vigente AHORA? ${isInabilityVigent}`);

    if (isInabilityVigent) {
      // console.log(`[InabilityService] CREATE: Incapacidad VIGENTE AHORA - Cambiar worker ${createInabilityDto.id_worker} a DISABLE`);
      try {
        const updatedWorker = await this.prisma.worker.update({
          where: { id: createInabilityDto.id_worker },
          data: { status: 'DISABLE' },
        });
        // console.log(`[InabilityService] CREATE: Worker actualizado exitosamente - nuevo status: ${updatedWorker.status}`);
      } catch (error) {
        console.error(`[InabilityService] CREATE: ERROR al actualizar worker - ${error}`);
        throw error;
      }
    } else {
      // console.log(`[InabilityService] CREATE: Incapacidad NO vigente AHORA - Guardar pero NO cambiar estado`);
    }

      return response;
    } catch (error) {
      throw new Error(`Error creating inability: ${error}`);
    }
  }

  async findAll(id_site?: number, userRole: string = 'ADMIN', id_subsite?: number | null) {
    try {
      if (!id_site) {
        return { status: 404, message: 'Site not found or not assigned to user' };
      }
      const response = await this.prisma.inability.findMany({
        where: {
          worker: {
            id_site,
            ...(id_subsite ? { id_subsite } : {}),
          }
        },
        include:{
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
        }
      });
      return response;
    } catch (error) {
      return { status: 500, message: `Error finding all inabilities: ${error}` };
    }
  }

  async findOne(id: number, id_site?: number, userRole: string = 'ADMIN') {
    try {
      const response = await this.prisma.inability.findUnique({
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
        return { status: 404, message: `Inability with id ${id} not found` };
      }
      
      // Validar que la incapacidad pertenece a esta site (solo para no-SUPERADMIN)
      if (userRole !== 'SUPERADMIN' && id_site !== undefined && response.worker.id_site !== id_site) {
        return { status: 404, message: `Inability with id ${id} not found in site ${id_site}` };
      }
      
      return response;
    } catch (error) {
      throw new Error(`Error finding inability with id ${id}: ${error}`);
    }
  }

  async findByDni(dni: string, id_site?: number, userRole: string = 'ADMIN') {
    try {
      // Ambos usan el siteId del request
      const response = await this.prisma.inability.findMany({
        where: {
          worker: {
            dni: dni,
            ...(id_site && { id_site })
          }
        },
        include: {
          worker: {
            select: {
              name: true,
              dni: true,
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
        return { status: 404, message: `No inabilities found for DNI ${dni}` };
      }
      return response;
    } catch (error) {
      throw new Error(`Error finding inabilities by DNI ${dni}: ${error}`);
    }
  }

  async findByFilters(filters: FilterInabilityDto) {
    try {
      const validation = await this.validate.validateAllIds({
        workerIds: filters.id_worker ? [filters.id_worker] : [],
      })
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
        if (filters.dni) {
          where.worker = {
            ...where.worker,
            dni: filters.dni
          };
        }
        if (filters.type) {
          where.type = filters.type;
        }
        if (filters.cause) {
          where.cause = filters.cause;
        }

        if (filters.dateDisableEnd || filters.dateDisableStart) {
         if(filters.dateDisableEnd){
          where.dateDisableEnd = filters.dateDisableEnd;
         }
          if(filters.dateDisableStart){
            where.dateDisableStart = filters.dateDisableStart;
          }
        }
      }
      const response = await this.prisma.inability.findMany({
        where,
        include: {
          worker: {
            select: {
              name: true,
              dni: true,
            },
          },
        },
        orderBy: {
          dateDisableStart: 'desc',
        },
      });

      if (!response || response.length === 0) {
        return { status: 404, message: 'No inabilities found' };
      }
      return response;
    } catch (error) {
      throw new Error(`Error finding inabilities by filters: ${error}`);
    }
  }

  async update(id: number, updateInabilityDto: UpdateInabilityDto, id_site?: number, userRole: string = 'ADMIN') {
    try {
      const validation = await this.findOne(id, id_site, userRole);
      if (validation['status'] != undefined) {
        return validation;
      }
      
      const workerId = validation['id_worker'];
      const response = await this.prisma.inability.update({
        where: { id },
        data: this.normalizeDateFields(updateInabilityDto),
      });

      // Obtener la incapacidad COMPLETA después de actualizar (por si solo se actualizaron algunos campos)
      const updatedInabilityFull = await this.prisma.inability.findUnique({
        where: { id },
      });

      // ÚNICO criterio: verifica si AHORA MISMO está dentro del rango de la incapacidad actualizada
      const isInabilityVigent = this.isInabilityActive(updatedInabilityFull);
      
      // console.log(`[InabilityService] UPDATE: Incapacidad ${id} - ¿Vigente AHORA? ${isInabilityVigent}`);

      if (isInabilityVigent) {
        // console.log(`[InabilityService] UPDATE: Incapacidad VIGENTE AHORA - Cambiar worker ${workerId} a DISABLE`);
        try {
          const updatedWorker = await this.prisma.worker.update({
            where: { id: workerId },
            data: { status: 'DISABLE' },
          });
          // console.log(`[InabilityService] UPDATE: Worker actualizado exitosamente - nuevo status: ${updatedWorker.status}`);
        } catch (error) {
          console.error(`[InabilityService] UPDATE: ERROR al actualizar worker - ${error}`);
          throw error;
        }
      } else {
        // console.log(`[InabilityService] UPDATE: Incapacidad NO vigente AHORA - Cambiar worker a AVALIABLE`);
        try {
          const updatedWorker = await this.prisma.worker.update({
            where: { id: workerId },
            data: { status: 'AVALIABLE' },
          });
          // console.log(`[InabilityService] UPDATE: Worker actualizado exitosamente - nuevo status: ${updatedWorker.status}`);
        } catch (error) {
          console.error(`[InabilityService] UPDATE: ERROR al actualizar worker - ${error}`);
          throw error;
        }
      }

      return response;
    } catch (error) {
      throw new Error(`Error updating inability with id ${id}: ${error}`);
    }
  }

  async remove(id: number, id_site?: number, userRole: string = 'ADMIN') {
    try {
      const validation = await this.findOne(id, id_site, userRole);
      if (validation['status'] != undefined) {
        return validation;
      }
      
      const workerId = validation['id_worker'];
      const response = await this.prisma.inability.delete({
        where: { id },
      });

      // Verificar si hay incapacidades vigentes AHORA después de eliminar
      const allInabilities = await this.prisma.inability.findMany({
        where: { id_worker: workerId },
      });

      // Buscar si hay incapacidades vigentes AHORA
      const hasActiveInabilities = allInabilities.some(i => this.isInabilityActive(i));

      // console.log(`[InabilityService] REMOVE: Total incapacidades: ${allInabilities.length}, ¿Hay alguna vigente AHORA? ${hasActiveInabilities}`);

      if (hasActiveInabilities) {
        // console.log(`[InabilityService] REMOVE: Mantener worker ${workerId} en DISABLE`);
        try {
          const updatedWorker = await this.prisma.worker.update({
            where: { id: workerId },
            data: { status: 'DISABLE' },
          });
          // console.log(`[InabilityService] REMOVE: Worker actualizado exitosamente - status: ${updatedWorker.status}`);
        } catch (error) {
          console.error(`[InabilityService] REMOVE: ERROR al actualizar worker - ${error}`);
          throw error;
        }
      } else {
        // console.log(`[InabilityService] REMOVE: NO hay incapacidades vigentes - Verificando permisos vigentes...`);
        
        // Verificar si hay permisos vigentes
        const allPermissions = await this.prisma.permission.findMany({
          where: { id_worker: workerId },
        });

        const hasActivePermissions = allPermissions.some(p => this.isPermissionActive(p));
        // console.log(`[InabilityService] REMOVE: ¿Hay permisos vigentes AHORA? ${hasActivePermissions}`);

        const newStatus: 'AVALIABLE' | 'PERMISSION' = hasActivePermissions ? 'PERMISSION' : 'AVALIABLE';

        // console.log(`[InabilityService] REMOVE: Cambiar worker ${workerId} a ${newStatus}`);
        try {
          const updatedWorker = await this.prisma.worker.update({
            where: { id: workerId },
            data: { status: newStatus },
          });
          // console.log(`[InabilityService] REMOVE: Worker actualizado exitosamente - status: ${updatedWorker.status}`);
        } catch (error) {
          console.error(`[InabilityService] REMOVE: ERROR al actualizar worker - ${error}`);
          throw error;
        }
      }

      return response;
    } catch (error) {
      throw new Error(`Error removing inability with id ${id}: ${error}`);
    }
  }
}
