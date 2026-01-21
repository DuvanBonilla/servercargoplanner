import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateCalledAttentionDto } from './dto/create-called-attention.dto';
import { UpdateCalledAttentionDto } from './dto/update-called-attention.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { ValidationService } from 'src/common/validation/validation.service';
import { FilterCalledAttentionDto } from './dto/filter-called-attention';
import { PaginationCalledService } from 'src/common/services/pagination/called-attention/pagination-called.service';
/**
 * Servicio para gestionar las atenciones llamadas
 * @class CalledAttentionService
 * @category Service
 */
@Injectable()
export class CalledAttentionService {
  /**
   *  Constructor del servicio
   * @param prisma
   * @param validation
   */
  constructor(
    private prisma: PrismaService,
    private validation: ValidationService,
    private paginateService: PaginationCalledService,
  ) {}

  /**
   * Crear una atencion llamada
   * @param createCalledAttentionDto datos de la atencion llamada a crear
   * @returns respuesta de la creacion de la atencion llamada
   */
  async create(
  createCalledAttentionDto: CreateCalledAttentionDto,
  id_site?: number,
) {
  try {
    // ✅ VALIDAR QUE id_user EXISTA PRIMERO
    if (createCalledAttentionDto.id_user === undefined) {
      return { message: 'User ID is required', status: 400 };
    }

    // ✅ ASEGURAR QUE EL DNI SEA STRING
    const dniWorker =
      typeof createCalledAttentionDto.dni_worker === 'number'
        ? String(createCalledAttentionDto.dni_worker)
        : typeof createCalledAttentionDto.dni_worker === 'string'
        ? createCalledAttentionDto.dni_worker
        : undefined;

    if (!dniWorker) {
      return { message: 'Worker DNI is required', status: 400 };
    }

    // ✅ CREAR VARIABLE LOCAL PARA id_user ASEGURADO
    const userId = createCalledAttentionDto.id_user; // Ya sabemos que no es undefined

    console.log(
      '[CalledAttentionService] Creando atención con DNI (transformado):',
      dniWorker,
      '(tipo:',
      typeof dniWorker,
      ') - Usuario:',
      userId,
    );

    // ✅ BUSCAR EL TRABAJADOR POR DNI Y VALIDAR
    const worker = await this.prisma.worker.findUnique({
      where: { dni: dniWorker },
      select: {
        id: true,
        dni: true,
        name: true,
        status: true,
        id_site: true,
        failures: true,
      },
    });

    if (!worker) {
      return {
        message: `Trabajador con DNI ${dniWorker} no encontrado`,
        status: 404,
      };
    }

    console.log('[CalledAttentionService] Trabajador encontrado:', worker);

    // ✅ VALIDAR PERMISOS POR SITE
    if (id_site !== undefined && worker.id_site !== id_site) {
      return {
        message: 'Not authorized to create attention for this worker',
        status: 409,
      };
    }

    // ✅ VALIDAR QUE EL TRABAJADOR ESTÉ DISPONIBLE
    if (worker.status === 'UNAVALIABLE' || worker.status === 'DEACTIVATED') {
      return {
        message:
          'Cannot create attention for unavailable or deactivated worker',
        status: 400,
      };
    }

    // ✅ USAR TRANSACCIÓN PARA CREAR LA ATENCIÓN Y ACTUALIZAR EL CONTADOR DE FAILURES
    const result = await this.prisma.$transaction(async (prisma) => {
      // Crear la atención llamada
      const calledAttention = await prisma.calledAttention.create({
        data: {
          dni_worker: dniWorker,
          description: createCalledAttentionDto.description,
          type: createCalledAttentionDto.type,
          id_user: userId, // ✅ USAR LA VARIABLE LOCAL ASEGURADA
        },
        include: {
          worker: {
            select: {
              dni: true,
              name: true,
              id_site: true,
              status: true,
            },
          },
          user: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      // ✅ INCREMENTAR EL CONTADOR DE FAILURES EN EL WORKER
      const updatedWorker = await prisma.worker.update({
        where: { dni: dniWorker },
        data: {
          failures: {
            increment: 1, // Incrementar en 1 el contador de failures
          },
        },
        select: {
          dni: true,
          name: true,
          failures: true,
        },
      });

      console.log(
        '[CalledAttentionService] Contador de failures actualizado:',
        `${updatedWorker.name} (DNI: ${updatedWorker.dni}) ahora tiene ${updatedWorker.failures} failures`,
      );

      return calledAttention;
    });

    console.log(
      '[CalledAttentionService] Atención creada exitosamente:',
      result.id,
    );
    return result;
  } catch (error) {
    console.error('[CalledAttentionService] Error creando atención:', error);
    throw new Error(error.message);
  }
}

  /**
   * Obtener todas las atenciones llamadas de trabajadores activos de los últimos 3 meses
   * @returns respuesta de la busqueda de todas las atenciones llamadas activas recientes
   */
  // async findAll(id_site?: number) {
  //   try {
  //     // Calcular la fecha de hace 3 meses
  //     const threeMonthsAgo = new Date();
  //     threeMonthsAgo.setDate(threeMonthsAgo.getDate() - 40);

  //     const maxDate = new Date();
  //     maxDate.setDate(maxDate.getDate() + 1);
  //     const response = await this.prisma.calledAttention.findMany({
  //       where: {
  //         // Filtrar por estado del trabajador
  //         worker: {
  //           status: {
  //             notIn: ['UNAVALIABLE'],
  //           },
  //           id_site: id_site,
  //         },
  //         // Filtrar por fecha (mes actual)
  //         createAt: {
  //           gte: threeMonthsAgo,
  //           lte: maxDate,
  //         },
  //       },
  //       include: {
  //         worker: {
  //           select: {
  //             dni: true,
  //             name: true,
  //             id_site: true,
  //           },
  //         },
  //       },
  //       orderBy: {
  //         createAt: 'desc', // Ordenar por fecha de creación descendente (más reciente primero)
  //       },
  //     });

  //     if (response.length === 0) {
  //       throw new NotFoundException('No called attentions found for active workers in the last 3 months');
  //     }

  //     return response;
  //   } catch (error) {
  //     console.error('Error finding called attentions:', error);
  //     throw new Error(error.message);
  //   }
  // }

  async findAll(id_site?: number) {
    try {
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setDate(threeMonthsAgo.getDate() - 90);

      const maxDate = new Date();
      maxDate.setDate(maxDate.getDate() + 1);

      const response = await this.prisma.calledAttention.findMany({
        where: {
          worker: {
            status: {
              notIn: ['UNAVALIABLE', 'DEACTIVATED'],
            },
            ...(id_site && { id_site: id_site }),
          },
          createAt: {
            gte: threeMonthsAgo,
            lte: maxDate,
          },
        },
        include: {
          worker: {
            select: {
              dni: true,
              name: true,
              id_site: true,
              status: true,
              failures: true,
            },
          },
          user: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          createAt: 'desc',
        },
      });

      return response;
    } catch (error) {
      console.error(
        '[CalledAttentionService] Error obteniendo atenciones:',
        error,
      );
      throw new Error(error.message);
    }
  }

  /**
   * Obtener una atencion llamada por ID
   * @param id ID de la atencion llamada a buscar
   * @returns respuesta de la busqueda de la atencion llamada
   */
  async findOne(id: number, id_site?: number) {
    try {
      const response = await this.prisma.calledAttention.findUnique({
        where: { id },
        include: {
          worker: {
            select: {
              dni: true,
              name: true,
              id_site: true,
              status: true,
              failures: true,
            },
          },
          user: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      if (!response) {
        return { message: 'Atención no encontrada', status: 404 };
      }

      // ✅ VALIDAR PERMISOS POR SITE
      if (id_site !== undefined && response.worker.id_site !== id_site) {
        return {
          message: 'No autorizado para acceder a esta atención',
          status: 403,
        };
      }

      return response;
    } catch (error) {
      console.error(
        '[CalledAttentionService] Error obteniendo atención:',
        error,
      );
      throw new Error(error.message);
    }
  }

  /**
   * Obtener atenciones llamadas por DNI del trabajador
   * @param dni_worker DNI del trabajador
   * @param id_site ID del sitio (opcional)
   * @returns Lista de atenciones llamadas asociadas al DNI del trabajador
   */
  async findByWorkerDni(dni_worker: string, id_site?: number) {
    try {
      const response = await this.prisma.calledAttention.findMany({
        where: {
          dni_worker: dni_worker,
          ...(id_site && {
            worker: {
              id_site: id_site,
            },
          }),
        },
        include: {
          worker: {
            select: {
              dni: true,
              name: true,
              id_site: true,
              status: true,
              failures: true,
            },
          },
          user: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          createAt: 'desc',
        },
      });

      return response;
    } catch (error) {
      console.error(
        '[CalledAttentionService] Error obteniendo atenciones por DNI:',
        error,
      );
      throw new Error(error.message);
    }
  }

  /**
   * Actualizar una atencion llamada
   * @param id ID de la atencion llamada a actualizar
   * @param updateCalledAttentionDto datos de la atencion llamada a actualizar
   * @returns respuesta de la actualizacion de la atencion llamada
   */
  async update(
    id: number,
    updateCalledAttentionDto: UpdateCalledAttentionDto,
    id_site?: number,
  ) {
    try {
      // ✅ VERIFICAR QUE LA ATENCIÓN EXISTE
      const existingAttention = await this.findOne(id, id_site);
      if ('status' in existingAttention && existingAttention.status !== 200) {
        return existingAttention;
      }

      // ✅ SI SE ESTÁ CAMBIANDO EL DNI DEL TRABAJADOR, VALIDAR
      if (updateCalledAttentionDto.dni_worker) {
        const worker = await this.prisma.worker.findUnique({
          where: { dni: updateCalledAttentionDto.dni_worker },
          select: {
            id: true,
            dni: true,
            name: true,
            status: true,
            id_site: true,
          },
        });

        if (!worker) {
          return {
            message: `Trabajador con DNI ${updateCalledAttentionDto.dni_worker} no encontrado`,
            status: 404,
          };
        }

        // ✅ VALIDAR PERMISOS POR SITE
        if (id_site !== undefined && worker.id_site !== id_site) {
          return {
            message: 'No autorizado para asignar atención a este trabajador',
            status: 403,
          };
        }

        // ✅ VALIDAR QUE EL TRABAJADOR ESTÉ DISPONIBLE
        if (
          worker.status === 'UNAVALIABLE' ||
          worker.status === 'DEACTIVATED'
        ) {
          return {
            message: 'No se puede asignar atención a trabajador no disponible',
            status: 400,
          };
        }
      }

      const response = await this.prisma.calledAttention.update({
        where: { id },
        data: updateCalledAttentionDto,
        include: {
          worker: {
            select: {
              dni: true,
              name: true,
              id_site: true,
              status: true,
            },
          },
          user: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      return response;
    } catch (error) {
      console.error(
        '[CalledAttentionService] Error actualizando atención:',
        error,
      );
      throw new Error(error.message);
    }
  }

  /**
   * Eliminar una atencion llamada
   * @param id ID de la atencion llamada a eliminar
   * @returns respuesta de la eliminacion de la atencion llamada
   * @throws Error
   */
  async remove(id: number, id_site?: number) {
  try {
    const existingAttention = await this.findOne(id, id_site);
    if ('status' in existingAttention && existingAttention.status !== 200) {
      return existingAttention;
    }

    // ✅ USAR TRANSACCIÓN PARA ELIMINAR LA ATENCIÓN Y DECREMENTAR EL CONTADOR
    const result = await this.prisma.$transaction(async (prisma) => {
      // Obtener los datos de la atención antes de eliminarla
      const attentionToDelete = await prisma.calledAttention.findUnique({
        where: { id },
        include: {
          worker: {
            select: {
              dni: true,
              name: true,
              failures: true,
            },
          },
        },
      });

      if (!attentionToDelete) {
        throw new Error('Called attention not found');
      }

      // Eliminar la atención
      const deletedAttention = await prisma.calledAttention.delete({
        where: { id },
        include: {
          worker: {
            select: {
              dni: true,
              name: true,
            },
          },
        },
      });

      // ✅ DECREMENTAR EL CONTADOR DE FAILURES EN EL WORKER
      if (attentionToDelete.worker.failures > 0) {
        const updatedWorker = await prisma.worker.update({
          where: { dni: attentionToDelete.worker.dni },
          data: {
            failures: {
              decrement: 1,
            },
          },
          select: {
            dni: true,
            name: true,
            failures: true,
          },
        });

        console.log(
          '[CalledAttentionService] Contador de failures decrementado:',
          `${updatedWorker.name} (DNI: ${updatedWorker.dni}) ahora tiene ${updatedWorker.failures} failures`
        );
      }

      return deletedAttention;
    });

    return result;
  } catch (error) {
    console.error('[CalledAttentionService] Error eliminando atención:', error);
    throw new Error(error.message);
  }
}

  /**
   * Buscar atenciones por texto (DNI, nombre del trabajador, descripción)
   */
  async searchAttentions(searchTerm: string, id_site?: number) {
    try {
      const response = await this.prisma.calledAttention.findMany({
        where: {
          OR: [
            {
              dni_worker: {
                contains: searchTerm,
                mode: 'insensitive',
              },
            },
            {
              description: {
                contains: searchTerm,
                mode: 'insensitive',
              },
            },
            {
              worker: {
                name: {
                  contains: searchTerm,
                  mode: 'insensitive',
                },
              },
            },
          ],
          ...(id_site && {
            worker: {
              id_site: id_site,
            },
          }),
        },
        include: {
          worker: {
            select: {
              dni: true,
              name: true,
              id_site: true,
              status: true,
              failures: true,
            },
          },
          user: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          createAt: 'desc',
        },
      });

      return response;
    } catch (error) {
      console.error(
        '[CalledAttentionService] Error buscando atenciones:',
        error,
      );
      throw new Error(error.message);
    }
  }

  /**
   * Obtener atenciones llamadas por ID del trabajador (usando la relación antigua)
   * @param id_worker ID del trabajador
   * @param id_site ID del sitio (opcional)
   * @returns Lista de atenciones llamadas asociadas al trabajador
   */
  async findOneByIdWorker(id_worker: number, id_site?: number) {
    try {
      // Primero obtener el trabajador para validar y obtener su DNI
      const worker = await this.prisma.worker.findUnique({
        where: { id: id_worker },
        select: {
          id: true,
          dni: true,
          name: true,
          status: true,
          id_site: true,
          failures: true,
        },
      });

      if (!worker) {
        return {
          message: `Trabajador con ID ${id_worker} no encontrado`,
          status: 404,
        };
      }

      // Validar permisos por site
      if (id_site !== undefined && worker.id_site !== id_site) {
        return {
          message:
            'No autorizado para acceder a las atenciones de este trabajador',
          status: 403,
        };
      }

      // Buscar atenciones por DNI del trabajador
      const response = await this.prisma.calledAttention.findMany({
        where: {
          dni_worker: worker.dni,
        },
        include: {
          worker: {
            select: {
              dni: true,
              name: true,
              id_site: true,
              status: true,
              failures: true,
            },
          },
          user: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          createAt: 'desc',
        },
      });

      if (response.length === 0) {
        return {
          message: `No se encontraron atenciones para el trabajador ${worker.name}`,
          status: 404,
        };
      }

      return response;
    } catch (error) {
      console.error(
        '[CalledAttentionService] Error obteniendo atenciones por ID del trabajador:',
        error,
      );
      throw new Error(error.message);
    }
  }

  /**
   * Obtener atenciones llamadas con paginación
   * @param page Número de página
   * @param limit Elementos por página
   * @param filters Filtros opcionales
   * @param activatePaginated Si activar paginación
   * @returns Respuesta paginada con atenciones llamadas
   */
  async findAllPaginated(
    page: number = 1,
    limit: number = 10,
    filters?: FilterCalledAttentionDto,
    activatePaginated: boolean = true,
  ) {
    try {
    
      // Usar el servicio de paginación específico para called attention
      const response = await this.paginateService.paginateCalledAttentions({
        prisma: this.prisma,
        page,
        limit,
        filters,
        activatePaginated,
      });
      
      if (response.items.length === 0) {
        // console.log(`[CalledAttentionService] ⚠️ No se encontraron registros de faltas para los filtros aplicados`);
        // if (filters?.id_site) {
        //   console.log(`[CalledAttentionService] ⚠️ Filtro id_site=${filters.id_site} - Verificar que existan registros para este sitio`);
        // }
      }
      
      return response;
    } catch (error) {
      console.error(
        '[CalledAttentionService] Error obteniendo atenciones paginadas:',
        error,
      );
      throw new Error(
        `Error obteniendo atenciones paginadas: ${error.message}`,
      );
    }
  }
}
