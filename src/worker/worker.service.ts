import { Injectable } from '@nestjs/common';
import { CreateWorkerDto } from './dto/create-worker.dto';
import { UpdateWorkerDto } from './dto/update-worker.dto';
import { PrismaService } from '../prisma/prisma.service';
import { ValidationService } from 'src/common/validation/validation.service';
import { getColombianDateTime } from 'src/common/utils/dateColombia';

/**
 * Servicio para gestionar trabajadores
 * @class workerService
 * @category Service
 */
@Injectable()
export class WorkerService {
  constructor(
    private prisma: PrismaService,
    private validationService: ValidationService,
  ) {}

  /**
   * Valida si un trabajador tiene permisos vigentes AHORA
   * @param workerId ID del trabajador
   * @returns true si tiene al menos un permiso vigente
   * @private
   */
  private async hasActivePermissions(workerId: number): Promise<boolean> {
    try {
      const now = getColombianDateTime();
      const today = now.toLocaleString('en-US', { timeZone: 'America/Bogota' });
      const [month, day, year] = today.split('/');
      const todayDate = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day), 0, 0, 0, 0));

      // Obtener permisos que NO han expirado (dateDisableEnd >= HOY)
      const activePermissions = await this.prisma.permission.findMany({
        where: {
          id_worker: workerId,
          dateDisableEnd: { gte: todayDate },
        },
        select: {
          id: true,
          dateDisableStart: true,
          dateDisableEnd: true,
          timeStart: true,
          timeEnd: true,
        },
      });

      // Validar que el permiso sea vigente AHORA considerando hora
      for (const permission of activePermissions) {
        const dateStart = new Date(Date.UTC(
          permission.dateDisableStart.getUTCFullYear(),
          permission.dateDisableStart.getUTCMonth(),
          permission.dateDisableStart.getUTCDate(),
          0, 0, 0, 0
        ));
        const dateEnd = new Date(Date.UTC(
          permission.dateDisableEnd.getUTCFullYear(),
          permission.dateDisableEnd.getUTCMonth(),
          permission.dateDisableEnd.getUTCDate(),
          0, 0, 0, 0
        ));

        // Si está entre las fechas, validar la hora
        if (now >= dateStart && now <= dateEnd) {
          if (permission.timeStart && permission.timeEnd) {
            const [startHour, startMin] = permission.timeStart.split(':').map(Number);
            const [endHour, endMin] = permission.timeEnd.split(':').map(Number);

            const timeStartDate = new Date(now);
            timeStartDate.setHours(startHour, startMin, 0, 0);

            const timeEndDate = new Date(now);
            timeEndDate.setHours(endHour, endMin, 0, 0);

            if (now >= timeStartDate && now <= timeEndDate) {
              return true;
            }
          } else {
            // Si no hay hora, solo validar por fecha
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      console.error(`[WorkerService] Error checking active permissions for worker ${workerId}:`, error);
      return false;
    }
  }

  /**
   * Valida si un trabajador tiene incapacidades vigentes HOY
   * @param workerId ID del trabajador
   * @returns true si tiene al menos una incapacidad vigente
   * @private
   */
  private async hasActiveInabilities(workerId: number): Promise<boolean> {
    try {
      const now = getColombianDateTime();
      const today = now.toLocaleString('en-US', { timeZone: 'America/Bogota' });
      const [month, day, year] = today.split('/');
      const todayDate = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day), 0, 0, 0, 0));

      const activeInabilities = await this.prisma.inability.findMany({
        where: {
          id_worker: workerId,
          dateDisableStart: { lte: todayDate },
          dateDisableEnd: { gte: todayDate },
        },
        select: { id: true },
        take: 1,
      });

      return activeInabilities.length > 0;
    } catch (error) {
      console.error(`[WorkerService] Error checking active inabilities for worker ${workerId}:`, error);
      return false;
    }
  }

  /**
   * Determina y actualiza el estado correcto del trabajador basado en permisos/incapacidades
   * @param workerId ID del trabajador
   * @private
   */
  private async updateWorkerStatus(workerId: number): Promise<void> {
    try {
      const worker = await this.prisma.worker.findUnique({
        where: { id: workerId },
        select: { id: true, status: true },
      });

      if (!worker) return;

      // Si está DISABLE (incapacidad permanente) o DEACTIVATED (contrato terminado), no cambiar
      if (worker.status === 'DISABLE' || worker.status === 'DEACTIVATED') return;

      // Verificar estado actual basado en permisos/incapacidades
      const hasPermission = await this.hasActivePermissions(workerId);
      const hasInability = await this.hasActiveInabilities(workerId);

      let correctStatus: string;

      if (hasInability) {
        // Si tiene incapacidad vigente, debe estar en DISABLE
        correctStatus = 'DISABLE';
      } else if (hasPermission) {
        // Si tiene permiso vigente (y no tiene incapacidad), debe estar en PERMISSION
        correctStatus = 'PERMISSION';
      } else {
        // Si no tiene permisos ni incapacidades, debe estar en AVALIABLE
        // (solo si no está ASSIGNED a una operación)
        if (worker.status !== 'ASSIGNED') {
          correctStatus = 'AVALIABLE';
        } else {
          // Si está ASSIGNED, no cambiar (es responsabilidad de otro servicio)
          return;
        }
      }

      // Actualizar solo si cambió
      if (worker.status !== correctStatus) {
        // console.log(`[WorkerService] 🔄 Corrigiendo estado del worker ${workerId}: ${worker.status} → ${correctStatus}`);
        await this.prisma.worker.update({
          where: { id: workerId },
          data: { status: correctStatus as any },
        });
      }
    } catch (error) {
      console.error(`[WorkerService] Error updating worker status for ${workerId}:`, error);
      // No throw - queremos que la consulta siga funcionando aunque falle la validación
    }
  }

  /**
   * craer un trabajador
   * @param createWorkerDto datos del trabajador a crear
   * @param id_site sede del usuario
   * @param userRole rol del usuario (SUPERADMIN, ADMIN, etc.)
   * @returns respuesta de la creacion del trabajador
   */
  async create(createWorkerDto: CreateWorkerDto, id_site?: number, userRole: string = 'ADMIN') {
    const requestId = Math.random().toString(36).substring(7);
    // console.log(`[WorkerService] 🆔 Iniciando creación de trabajador - Request ID: ${requestId}`);
    // console.log(`[WorkerService] 🔐 Rol del usuario: ${userRole}, Site: ${id_site}`);
    
    try {
      // ✅ VALIDACIÓN DE ACCESO BASADA EN ROL
      // SUPERADMIN puede crear workers en cualquier site
      // ADMIN solo puede crear en su site asignado
      if (userRole !== 'SUPERADMIN' && createWorkerDto.id_site && createWorkerDto.id_site !== id_site) {
        return {
          message: `Not authorized to create worker in site ${createWorkerDto.id_site}. Users with role ${userRole} can only create in site ${id_site}`,
          status: 403,
        };
      }
      const { dni, id_area, id_user, phone, code, payroll_code } =
        createWorkerDto;
        // Check if code exists but is assigned to a deactivated worker
    const existingWorker = await this.prisma.worker.findFirst({
      where: { 
        code,
        status:{
        not: 'DEACTIVATED'
        }
      }
    });

    // If code is in use by an active worker, return error
    if (existingWorker) {
      return {
        message: 'Worker code already in use by an active worker',
        status: 409,
      };
    }
      const validation = await this.validationService.validateAllIds({
        id_user: id_user,
        id_area: id_area,
        dni_worker: dni,
        code_worker: code,
        payroll_code_worker: payroll_code,
        phone_worker: phone,
      });

      // Agrega los logs aquí para depuración
      // console.log(`[WorkerService] ${requestId} - DTO:`, createWorkerDto);
      // console.log(`[WorkerService] ${requestId} - id_site usuario:`, id_site);
      // console.log(`[WorkerService] ${requestId} - Validación área:`, validation['area']);

      // Si la validación falla, retorna el error
      // if (
      //   !validation['area'] ||
      //   (validation['area'] && validation['area'].id_site !== id_site)
      // ) {
      //   return {
      //     message: 'Not authorized to create worker in this area',
      //     status: 409,
      //   };
      // }
      // Si hay un error, retornarlo
      if (
        validation &&
        'status' in validation &&
        (validation.status === 404 || validation.status === 409)
      ) {
        // console.log(`[WorkerService]  ❌ Validación falló:`, validation);
        return validation;
      }

      // console.log(`[WorkerService]✅ Todas las validaciones pasaron, procediendo a crear trabajador`);

      // Ensure id_user is defined before creating worker
      if (createWorkerDto.id_user === undefined) {
        return { message: 'User ID is required', status: 400 };
      }

      // console.log(`[WorkerService] Iniciando creación en base de datos...`);

      const response = await this.prisma.worker.create({
        data: {
          ...createWorkerDto,
          id_user: createWorkerDto.id_user,
        },
      });

      // console.log(`[WorkerService] ✅ Trabajador creado exitosamente:`, response.id);

      // --- Post-create verification to avoid race condition ---
      // 1) payroll_code must be unique across ALL workers
      if (createWorkerDto.payroll_code) {
        const existingPayroll = await this.prisma.worker.findFirst({
          where: {
            payroll_code: createWorkerDto.payroll_code,
            id: { not: response.id },
          },
        });

        if (existingPayroll) {
          // console.log(`[WorkerService]  ❌ Conflicto payroll_code detectado después de crear. Eliminando worker ${response.id}`);
          // Rollback: eliminar el registro creado y retornar error
          await this.prisma.worker.delete({ where: { id: response.id } });
          return {
            message: `Payroll code ${createWorkerDto.payroll_code} already exists`,
            status: 409,
          };
        }
      }

      // 2) code must not be used by any ACTIVE worker (i.e., ignore DEACTIVATED)
      if (createWorkerDto.code) {
        const existingActive = await this.prisma.worker.findFirst({
          where: {
            code: createWorkerDto.code,
            status: { not: 'DEACTIVATED' },
            id: { not: response.id },
          },
        });

        if (existingActive) {
          // console.log(`[WorkerService]  ❌ Conflicto code detectado después de crear. Eliminando worker ${response.id}`);
          // Rollback: eliminar el registro creado y retornar error
          await this.prisma.worker.delete({ where: { id: response.id } });
          return {
            message: `Code already exists`,
            status: 409,
          };
        }
      }

      // Si no hay conflictos post-creación, retornar el trabajador creado
      return response;
    } catch (error) {
      throw new Error(error.message || String(error));
    }
  }
  /**
   * obtener trabajador por dni
   * @param dni numero de identificacion del trabajador a buscar
   * @returns respuesta de la busqueda del trabajador
   */
  async finDni(dni: string, id_site?: number) {
    const response = await this.prisma.worker.findFirst({
      where: { dni, id_site },
    });
    if (!response) {
      return { message: 'Not found', status: 404 };
    }
    return response;
  }

  /**
   * obtener todos los trabajadores
   * @param id_site filtro por sede (opcional)
   * @param id_subsite filtro por subsede (opcional)
   * @param globalSearch si es true, no filtra por sede para mostrar nombres globalmente
   * @returns respuesta de la búsqueda de todos los trabajadores
   */
  // async findAll(id_site?: number, id_subsite?: number | null, globalSearch: boolean = false) {
  //   try {
  //     let whereClause: any = {};

  //     // Solo filtrar por sede si no es búsqueda global
  //     if (!globalSearch && id_site) {
  //       whereClause.id_site = id_site;
  //     }

  //     // Solo filtrar por id_subsite si es un número válido (no null ni undefined) y no es búsqueda global
  //     if (!globalSearch && typeof id_subsite === 'number') {
  //       whereClause.id_subsite = id_subsite;
  //     }

  //     const response = await this.prisma.worker.findMany({
  //       where: whereClause,
  //       include: {
  //         jobArea: {
  //           select: {
  //             id: true,
  //             name: true,
  //           },
  //         },
  //         Site: {
  //           select: {
  //             id: true,
  //             name: true,
  //           },
  //         },
  //       },
  //     });

  //     const transformResponse = response.map((res) => {
  //       const { id_area, ...rest } = res;
  //       return {
  //         ...rest,
  //         siteName: rest.Site?.name,
  //         areaName: rest.jobArea?.name,
  //       };
  //     });
  //     return transformResponse;
  //   } catch (error) {
  //     throw new Error(error);
  //   }
  // }

  // async findAll(id_site?: number, id_subsite?: number | null) {
  //   try {
  //     let whereClause: any = {};

  //     if (id_site) {
  //       whereClause.id_site = id_site;
  //     }

  //     // Solo filtrar por id_subsite si es un número válido (no null ni undefined)
  //     if (typeof id_subsite === 'number') {
  //       whereClause.id_subsite = id_subsite;
  //     }

  //     const response = await this.prisma.worker.findMany({
  //       where: whereClause,
  //       include: {
  //         jobArea: {
  //           select: {
  //             id: true,
  //             name: true,
  //           },
  //         },
  //         Site: {
  //           select: {
  //             name: true,
  //           },
  //         },
  //       },
  //     });

  //     const transformResponse = response.map((res) => {
  //       const { id_area, ...rest } = res;
  //       return rest;
  //     });
  //     return transformResponse;
  //   } catch (error) {
  //     throw new Error(error);
  //   }
  // }

  // async findAll(id_site?: number) {
  //   try {
  //     const response = await this.prisma.worker.findMany({
  //       where: {
  //         id_site,
  //       },
  //       include: {
  //         jobArea: {
  //           select: {
  //             id: true,
  //             name: true,
  //           },
  //         },
  //         Site: {
  //           select: {
  //             name: true,
  //           },
  //         },
  //       },
  //     });
  //     const transformResponse = response.map((res) => {
  //       const { id_area, ...rest } = res;
  //       return rest;
  //     });
  //     return transformResponse;
  //   } catch (error) {
  //     throw new Error(error);
  //   }
  // }

  async findAll(id_site?: number, id_subsite?: number | null) {
    try {
      let whereClause: any = {};

      if (id_site) {
        whereClause.id_site = id_site;
      }

      // // Solo filtra por subsede si es un número válido (no null ni undefined)
      // if (typeof id_subsite === 'number') {
      //   whereClause.id_subsite = id_subsite;
      // }

      const response = await this.prisma.worker.findMany({
        where: whereClause,
        include: {
          jobArea: {
            select: {
              id: true,
              name: true,
            },
          },
          Site: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          name: 'asc',
        },
      });

      const result = response.map((res) => ({
        ...res,
        siteName: res.Site?.name,
        areaName: res.jobArea?.name,
      }));

      // ✅ Lazy evaluation: Validar y corregir estado de cada worker en background
      // No bloqueamos la respuesta, pero iniciamos validación en paralelo
      Promise.all(result.map((worker) => this.updateWorkerStatus(worker.id))).catch((error) => {
        console.error('[WorkerService] Error during lazy status validation in findAll:', error);
      });

      return result;
    } catch (error) {
      throw new Error('Error get all Worker');
    }
  }
  /**
   * obtener un trabajador por su ID
   * @param id id del trabajador a buscar
   * @returns resupuesta de la busqueda del trabajador
   */
  // src/worker/worker.service.ts

async findOne(dni: string, id_site?: number) {
  try {
    //console.log(`[WorkerService] Buscando trabajador con DNI: ${dni}, site: ${id_site}`);
    
    const response = await this.prisma.worker.findUnique({
      where: { dni },
      include: {
        jobArea: true,
        user: {
          select: {
            name: true,
          },
        },
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
        calledAttention: {
          select: {
            id: true,
            description: true,
            type: true,
            createAt: true,
          },
          orderBy: {
            createAt: 'desc',
          },
          take: 10,
        },
      },
    });

    if (!response) {
      return { message: 'Worker not found', status: 404 };
    }

    if (id_site !== undefined && response.id_site !== id_site) {
      return { message: 'Not authorized to access this worker', status: 403 };
    }

    // ✅ Lazy evaluation: Validar y corregir estado en background
    // No bloqueamos la respuesta, iniciamos validación en paralelo
    this.updateWorkerStatus(response.id).catch((error) => {
      console.error(`[WorkerService] Error during lazy status validation for worker ${response.id}:`, error);
    });

    return response;
  } catch (error) {
    console.error('[WorkerService] Error finding worker by DNI:', error);
    throw new Error(error.message);
  }
}

/**
 * obtener un trabajador por su DNI
 * @param dni numero de identificacion del trabajador a buscar
 * @returns respuesta de la busqueda del trabajador
 */

async findById(id: number, id_site?: number) {
  try {
    //console.log(`[WorkerService] Buscando trabajador con ID: ${id}, site: ${id_site}`);
    
    const response = await this.prisma.worker.findUnique({
      where: { id },
      include: {
        jobArea: true,
        user: {
          select: {
            name: true,
          },
        },
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
        calledAttention: {
          select: {
            id: true,
            description: true,
            type: true,
            createAt: true,
          },
          orderBy: {
            createAt: 'desc',
          },
          take: 10,
        },
      },
    });

    if (!response) {
      return { message: 'Worker not found', status: 404 };
    }

    if (id_site !== undefined && response.id_site !== id_site) {
      return { message: 'Not authorized to access this worker', status: 403 };
    }

    // ✅ Lazy evaluation: Validar y corregir estado en background
    // No bloqueamos la respuesta, iniciamos validación en paralelo
    this.updateWorkerStatus(response.id).catch((error) => {
      console.error(`[WorkerService] Error during lazy status validation for worker ${response.id}:`, error);
    });

    return response;
  } catch (error) {
    console.error('[WorkerService] Error finding worker by ID:', error);
    throw new Error(error.message);
  }
}
  /**
   * actualizar un trabajador
   * @param id id del trabajador a actualizar
   * @param updateWorkerDto datos del trabajador a actualizar
   * @param id_site sede del usuario
   * @param userRole rol del usuario (SUPERADMIN, ADMIN, etc.)
   * @returns respuesta de la actualizacion del trabajador
   */
  async update(id: number, updateWorkerDto: UpdateWorkerDto, id_site?: number, userRole: string = 'ADMIN') {
    try {
      // console.log(`[WorkerService] 🔐 Actualizando worker ${id} - Rol: ${userRole}, Site: ${id_site}`);

      // ✅ OBTENER EL TRABAJADOR POR ID (sempre búsqueda simple)
      const currentWorker = await this.prisma.worker.findUnique({
        where: { id },
        select: { status: true, code: true, payroll_code: true, id_site: true }
      });

      if (!currentWorker) {
        return { message: 'Worker not found', status: 404 };
      }

      // ✅ VALIDACIÓN DE ACCESO BASADA EN ROL
      // SUPERADMIN puede actualizar workers en cualquier site
      // ADMIN solo puede actualizar en su site asignado
      if (userRole !== 'SUPERADMIN' && currentWorker.id_site !== id_site) {
        // console.log(`[WorkerService] ❌ ADMIN intenta actualizar worker de otro site: ${currentWorker.id_site} !== ${id_site}`);
        return {
          message: `Not authorized to update worker in site ${currentWorker.id_site}. Users with role ${userRole} can only update in site ${id_site}`,
          status: 403,
        };
      }
      
      // console.log(`[WorkerService] ✅ Acceso permitido. Rol: ${userRole}, Worker site: ${currentWorker.id_site}`);

      const validation = await this.validationService.validateAllIds({
        id_area: updateWorkerDto.id_area,
      });

      // ✅ VALIDAR QUE EL ÁREA PERTENEZCA AL SITE CORRECTO (para ADMIN)
      if (validation && 'area' in validation && validation['area']) {
        if (userRole !== 'SUPERADMIN' && validation['area'].id_site !== currentWorker.id_site) {
          // console.log(`[WorkerService] ❌ Área ${updateWorkerDto.id_area} no pertenece al site ${currentWorker.id_site}`);
          return {
            message: 'Not authorized. Area does not belong to your site',
            status: 409,
          };
        }
      }

      // Validar códigos si se están actualizando
      if (updateWorkerDto.code && updateWorkerDto.code !== currentWorker.code) {
        const codeValidation = await this.validationService.validateCodeForUpdate(updateWorkerDto.code, id);
        if (!codeValidation.available) {
          return {
            message: codeValidation.message,
            status: 409
          };
        }
      }

      if (updateWorkerDto.payroll_code && updateWorkerDto.payroll_code !== currentWorker.payroll_code) {
        const payrollCodeValidation = await this.validationService.validatePayrollCodeForUpdate(updateWorkerDto.payroll_code, id);
        if (!payrollCodeValidation.available) {
          return {
            message: payrollCodeValidation.message,
            status: 409
          };
        }
      }

      // Si cambia de DEACTIVATED a AVALIABLE, verificar que el código no esté en uso
      if (currentWorker.status === 'DEACTIVATED' && updateWorkerDto.status === 'AVALIABLE') {
        // console.log(`[WorkerService] Detectado cambio de DEACTIVATED a AVALIABLE para worker ${id}`);
        
        // Verificar si el código ya está siendo usado por otro trabajador activo
        const codeToCheck = updateWorkerDto.code || currentWorker.code;
        if (codeToCheck) {
          const codeValidation = await this.validationService.validateCodeForUpdate(codeToCheck, id);
          
          if (!codeValidation.available) {
            // console.log(`[WorkerService] ❌ Código ${codeToCheck} ya está en uso por otro trabajador activo`);
            return {
              message: `Cannot activate worker. ${codeValidation.message}. Please assign a new code first.`,
              status: 409
            };
          }
        }

        // Verificar lo mismo para el código de nómina
        const payrollCodeToCheck = updateWorkerDto.payroll_code || currentWorker.payroll_code;
        if (payrollCodeToCheck) {
          // Para el código de nómina, siempre validar que sea único (sin importar estado)
          const existingPayrollWorker = await this.prisma.worker.findFirst({
            where: {
              payroll_code: payrollCodeToCheck,
              id: {
                not: id // Excluir el trabajador actual
              }
            }
          });
          
          if (existingPayrollWorker) {
            // console.log(`[WorkerService] ❌ Código de nómina ${payrollCodeToCheck} ya está en uso por trabajador ${existingPayrollWorker.id}`);
            return {
              message: `Cannot activate worker. Payroll code ${payrollCodeToCheck} is already in use by another worker. Payroll codes must be unique.`,
              status: 409
            };
          }
        }

        // // console.log(`[WorkerService] ✅ Códigos disponibles, permitiendo activación del worker ${id}`);
      }

        // ✅ Preparar datos de actualización
      const dataToUpdate: any = { ...updateWorkerDto };
      
      // ✅ Si cambia de DEACTIVATED a AVAILABLE, actualizar createAt
      if (currentWorker.status === 'DEACTIVATED' && updateWorkerDto.status === 'AVALIABLE') {
        // console.log(`[WorkerService] 📅 Actualizando createAt a fecha actual por reactivación`);
        dataToUpdate.createAt = new Date();
      }

      // ✅ ACTUALIZAR SOLO POR ID (ya validamos acceso arriba)
      const response = await this.prisma.worker.update({
        where: { id },
        data: dataToUpdate,
      });
      
      //console.log(`[WorkerService] ✅ Worker ${id} actualizado exitosamente`);
      return response;
    } catch (error) {
      throw new Error(error);
    }
  }
  /**
   * eliminar un trabajador
   * @param id id del trabajador a eliminar
   * @returns respuesta de la eliminacion del trabajador
   */
  async remove(id: number) {
    try {
      const response = await this.prisma.worker.delete({
        where: { id },
      });
      return response;
    } catch (error) {
      throw new Error(error);
    }
  }

  // async addWorkedHoursOnOperationEnd(operationId: number) {
  //   // Obtener la operación y sus trabajadores
  //   const operation = await this.prisma.operation.findUnique({
  //     where: { id: operationId },
  //     include: { workers: true },
  //   });

  //   if (!operation || !operation.dateEnd || !operation.timeEnd) return;

  //   // Calcular horas trabajadas
  //   const start = new Date(operation.dateStart);
  //   const end = new Date(operation.dateEnd);

  //   // Si tienes timeStart y timeEnd como string tipo "HH:mm"
  //   const [startHour, startMin] = operation.timeStrat.split(':').map(Number);
  //   const [endHour, endMin] = operation.timeEnd.split(':').map(Number);

  //   start.setHours(startHour, startMin, 0, 0);
  //   end.setHours(endHour, endMin, 0, 0);

  //   const diffMs = end.getTime() - start.getTime();
  //   const diffHours = diffMs / (1000 * 60 * 60);

  //   // Sumar horas trabajadas a cada trabajador
  //   for (const opWorker of operation.workers) {
  //     await this.prisma.worker.update({
  //       where: { id: opWorker.id_worker },
  //       data: {
  //         hoursWorked: {
  //           increment: diffHours,
  //         },
  //       },
  //     });
  //   }
  // }

  // async addWorkedHoursOnOperationEnd(operationId: number) {
  //   // Obtener los Operation_Worker asociados a la operación, con fechas y horas de cada uno
  //   const operationWorkers = await this.prisma.operation_Worker.findMany({
  //     where: { id_operation: operationId },
  //     select: {
  //       id_worker: true,
  //       dateStart: true,
  //       dateEnd: true,
  //       timeStart: true,
  //       timeEnd: true,
  //     },
  //   });

  //   for (const opWorker of operationWorkers) {
  //     // Validar que existan fechas y horas
  //     if (
  //       !opWorker.dateStart ||
  //       !opWorker.dateEnd ||
  //       !opWorker.timeStart ||
  //       !opWorker.timeEnd
  //     ) {
  //       continue;
  //     }

  //     // Crear objetos Date para inicio y fin
  //     const start = new Date(opWorker.dateStart);
  //     const end = new Date(opWorker.dateEnd);

  //     // Parsear horas y minutos
  //     const [startHour, startMin] = opWorker.timeStart.split(':').map(Number);
  //     const [endHour, endMin] = opWorker.timeEnd.split(':').map(Number);

  //     start.setHours(startHour, startMin, 0, 0);
  //     end.setHours(endHour, endMin, 0, 0);

  //     const diffMs = end.getTime() - start.getTime();
  //     const diffHours = diffMs / (1000 * 60 * 60);

  //     // Solo sumar si la diferencia es positiva
  //     if (diffHours > 0) {
  //       await this.prisma.worker.update({
  //         where: { id: opWorker.id_worker },
  //         data: {
  //           hoursWorked: {
  //             increment: diffHours,
  //           },
  //         },
  //       });
  //     }
  //   }
  // }

  async addWorkedHoursOnOperationEnd(operationId: number) {
    // console.log(`[WorkerService] Iniciando cálculo de horas trabajadas para operación ${operationId}`);
    
    const operationWorkers = await this.prisma.operation_Worker.findMany({
      where: { 
        id_operation: operationId,
        id_worker: { not: -1 } // ✅ EXCLUIR PLACEHOLDERS
      },
      select: { id_worker: true, dateStart: true, dateEnd: true, timeStart: true, timeEnd: true },
    });

    // console.log(`[WorkerService] Encontrados ${operationWorkers.length} trabajadores en la operación`);

    for (const { id_worker, dateStart, dateEnd, timeStart, timeEnd } of operationWorkers) {
      // console.log(`[WorkerService] Procesando worker ${id_worker}:`, {
      //   dateStart: dateStart?.toISOString(),
      //   dateEnd: dateEnd?.toISOString(),
      //   timeStart,
      //   timeEnd
      // });

      if (!dateStart || !dateEnd || !timeStart || !timeEnd) {
        // console.log(`[WorkerService] ❌ Datos incompletos para worker ${id_worker} - saltando`);
        continue;
      }

      const start = new Date(dateStart);
      const end = new Date(dateEnd);
      const [sh, sm] = timeStart.split(':').map(Number);
      const [eh, em] = timeEnd.split(':').map(Number);
      start.setHours(sh, sm, 0, 0);
      end.setHours(eh, em, 0, 0);

      const diffHours = Math.round(((end.getTime() - start.getTime()) / 3_600_000) * 100) / 100;
      // console.log(`[WorkerService] diffHours calculadas para worker ${id_worker}:`, diffHours);
      
      if (diffHours > 0) {
        // console.log(`[WorkerService] ✅ Sumando ${diffHours} horas a worker ${id_worker}`);
        await this.prisma.worker.update({
          where: { id: id_worker },
          data: { hoursWorked: { increment: diffHours } },
        });
      } 
      // else {
      //   console.log(`[WorkerService] ⚠️ Horas calculadas no válidas (${diffHours}) para worker ${id_worker}`);
      // }
    }
    
    // console.log(`[WorkerService] ✅ Finalizado cálculo de horas para operación ${operationId}`);
  }

  /**
   * Verifica y corrige el estado de workers que están ASSIGNED pero no tienen operaciones activas
   * Este método es útil para corregir inconsistencias cuando una operación se marca como COMPLETED
   * directamente en la BD sin pasar por el flujo normal
   */
  async fixWorkerStatusForCompletedOperations() {
    try {
      // console.log('[WorkerService] 🔍 Verificando workers ASSIGNED sin operaciones activas...');

      // 1. Obtener todos los workers con status ASSIGNED
      const assignedWorkers = await this.prisma.worker.findMany({
        where: { status: 'ASSIGNED' },
        select: { id: true, dni: true, name: true },
      });

      // console.log(`[WorkerService] Encontrados ${assignedWorkers.length} workers con status ASSIGNED`);

      let fixedCount = 0;
      const workersFixed: Array<{ id: number; name: string; dni: string }> = [];

      for (const worker of assignedWorkers) {
        // 2. Verificar si el worker tiene operaciones activas (PENDING o INPROGRESS)
        const activeOperations = await this.prisma.operation_Worker.findMany({
          where: {
            id_worker: worker.id,
            operation: {
              status: { in: ['PENDING', 'INPROGRESS'] },
            },
          },
          include: {
            operation: {
              select: { id: true, status: true },
            },
          },
        });

        // 3. Si NO tiene operaciones activas, marcarlo como AVAILABLE
        if (activeOperations.length === 0) {
          // console.log(
          //   `[WorkerService] ✅ Worker ${worker.id} (${worker.name}) no tiene operaciones activas. Marcando como AVAILABLE...`,
          // );

          await this.prisma.worker.update({
            where: { id: worker.id },
            data: { status: 'AVALIABLE' },
          });

          fixedCount++;
          workersFixed.push({
            id: worker.id,
            name: worker.name,
            dni: worker.dni,
          });
        } else {
          // console.log(
          //   `[WorkerService] ℹ️ Worker ${worker.id} (${worker.name}) tiene ${activeOperations.length} operación(es) activa(s):`,
          //   activeOperations.map((op) => `Op ${op.operation.id} (${op.operation.status})`).join(', '),
          // );
        }
      }

      const summary = {
        totalAssigned: assignedWorkers.length,
        fixedToAvailable: fixedCount,
        stillAssigned: assignedWorkers.length - fixedCount,
        workersFixed,
      };

      // console.log('[WorkerService] 📊 Resumen de corrección:', summary);
      return summary;
    } catch (error) {
      console.error('[WorkerService] ❌ Error verificando estado de workers:', error);
      throw error;
    }
  }
}
