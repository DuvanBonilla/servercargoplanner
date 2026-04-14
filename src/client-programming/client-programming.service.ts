import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CreateClientProgrammingDto } from './dto/create-client-programming.dto';
import { UpdateClientProgrammingDto } from './dto/update-client-programming.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { FilterClientProgrammingDto } from './dto/filter-client-programming.dto';
import { ValidationClientProgrammingService } from 'src/common/validation/services/validation-client-programming/validation-client-programming.service';

@Injectable()
export class ClientProgrammingService {
  constructor(
    private prisma: PrismaService,
    private validationClientProgramming: ValidationClientProgrammingService
  ) {}
  async create(
    createClientProgrammingDto: CreateClientProgrammingDto,
    role?: string,
    subsiteId?: number,
  ) {
    try {
      // Permitir crear programaciones para hoy o el día siguiente
      const todayUTC = new Date();
      todayUTC.setUTCHours(0, 0, 0, 0);
      const tomorrowUTC = new Date(todayUTC);
      tomorrowUTC.setUTCDate(tomorrowUTC.getUTCDate() + 1);

      const inputDate = new Date(createClientProgrammingDto.dateStart);
      inputDate.setUTCHours(0, 0, 0, 0);

      if (inputDate < todayUTC || inputDate > tomorrowUTC) {
        throw new BadRequestException(
          `La fecha de inicio debe ser la fecha actual (${todayUTC.toISOString().split('T')[0]}) o el día siguiente (${tomorrowUTC.toISOString().split('T')[0]})`,
        );
      }

      // Separar campos que no son columnas de BD
      const { id_operation, force_assign, ...programmingData } =
        createClientProgrammingDto as any;
      const requestedStatus = programmingData.status;

      // --- Validaciones previas si se quiere crear ya como ASSIGNED ---
      let resolvedOperation: any = null;
      if (requestedStatus === 'ASSIGNED') {
        // 1. Solo ADMIN o SUPERADMIN pueden asignar
        if (role !== 'ADMIN' && role !== 'SUPERADMIN') {
          throw new ForbiddenException(
            'Solo usuarios con rol ADMIN o SUPERADMIN pueden crear una programación como ASSIGNED',
          );
        }

        // 2. id_operation es obligatorio
        if (!id_operation) {
          throw new BadRequestException(
            'Se debe proporcionar id_operation al crear con estado ASSIGNED',
          );
        }
        if (!Number.isInteger(id_operation) || id_operation < 1 || id_operation > 2147483647) {
          throw new BadRequestException(
            `id_operation "${id_operation}" no es un ID de operación válido`,
          );
        }

        // 3. Verificar que la operación existe
        resolvedOperation = await this.prisma.operation.findUnique({
          where: { id: id_operation },
        });
        if (!resolvedOperation) {
          throw new NotFoundException(`Operación con ID ${id_operation} no encontrada`);
        }

        // 4. Verificar que la operación pertenece al mismo site
        if (resolvedOperation.id_site !== programmingData.id_site) {
          throw new ConflictException(
            `La operación #${id_operation} pertenece al sitio ${resolvedOperation.id_site}, ` +
            `pero la programación pertenece al sitio ${programmingData.id_site}`,
          );
        }

        // 5. Verificar subsite
        const progSubsite = programmingData.id_subsite ?? subsiteId;
        if (
          progSubsite !== null &&
          progSubsite !== undefined &&
          resolvedOperation.id_subsite !== progSubsite
        ) {
          throw new ConflictException(
            `La operación #${id_operation} pertenece al subsitio ${resolvedOperation.id_subsite}, ` +
            `pero la programación pertenece al subsitio ${progSubsite}`,
          );
        }

        // 6. Si la operación ya tiene una programación asignada, exigir force_assign
        if (
          resolvedOperation.id_clientProgramming !== null &&
          resolvedOperation.id_clientProgramming !== undefined
        ) {
          if (!force_assign) {
            throw new ConflictException({
              requiresConfirmation: true,
              message:
                `La operación #${id_operation} ya tiene asignada la programación ` +
                `#${resolvedOperation.id_clientProgramming}. `
            });
          }
        }

        // 7. Si la operación está COMPLETED, validar fecha/hora dentro del rango
        if (resolvedOperation.status === 'COMPLETED') {
          const toDateOnly = (d: Date) => {
            const dt = new Date(d);
            dt.setUTCHours(0, 0, 0, 0);
            return dt;
          };

          const progDate = toDateOnly(new Date(programmingData.dateStart));
          const opDateStart = toDateOnly(resolvedOperation.dateStart);
          const opDateEnd = resolvedOperation.dateEnd
            ? toDateOnly(resolvedOperation.dateEnd)
            : opDateStart;

          const timeToMinutes = (t: string) => {
            const [h, m] = t.split(':').map(Number);
            return h * 60 + m;
          };

          const progTime: string = programmingData.timeStart;
          const progMinutes = timeToMinutes(progTime);
          const opTimeStartMin = timeToMinutes(resolvedOperation.timeStrat);
          const opTimeEndMin = resolvedOperation.timeEnd
            ? timeToMinutes(resolvedOperation.timeEnd)
            : opTimeStartMin;
          const opTimeRange =
            `${resolvedOperation.timeStrat} – ${resolvedOperation.timeEnd ?? resolvedOperation.timeStrat}`;
          const opDateRange =
            `${opDateStart.toISOString().split('T')[0]} – ${opDateEnd.toISOString().split('T')[0]}`;

          if (progDate < opDateStart || progDate > opDateEnd) {
            throw new ConflictException(
              `La fecha de la programación (${progDate.toISOString().split('T')[0]}) está fuera del rango de la operación. ` +
              `Rango de fechas permitido: ${opDateRange}. ` +
              `Rango horario de la operación: ${opTimeRange}. ` +
              `Ajuste la fecha y/o la hora para que coincidan con la operación.`,
            );
          }

          if (progMinutes < opTimeStartMin || progMinutes > opTimeEndMin) {
            throw new ConflictException(
              `La hora de la programación (${progTime}) está fuera del rango horario de la operación. ` +
              `Rango horario permitido: ${opTimeRange}. ` +
              `Rango de fechas de la operación: ${opDateRange}. ` +
              `Ajuste la hora para que coincida con la operación.`,
            );
          }

          // La operación ya está COMPLETED → la programación también queda COMPLETED
          programmingData.status = 'COMPLETED';
        }
      }

      const validationProgramming =
        await this.validationClientProgramming.validateClientProgramming({
          service_request: programmingData.service_request,
          service: programmingData.service,
          client: programmingData.client,
          ubication: programmingData.ubication,
          dateStart: programmingData.dateStart,
          timeStart: programmingData.timeStart,
        });
      if (
        (validationProgramming &&
          'status' in validationProgramming &&
          validationProgramming.status === 409) ||
        (validationProgramming && validationProgramming.status === 404)
      ) {
        console.error('Validation failed:', validationProgramming);
        return validationProgramming;
      }

      const response = await this.prisma.clientProgramming.create({
        data: programmingData,
      });

      // 8. Vincular la operación con la nueva programación
      if (requestedStatus === 'ASSIGNED' && id_operation) {
        await this.prisma.operation.update({
          where: { id: id_operation },
          data: { id_clientProgramming: response.id },
        });
      }

      return response;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ForbiddenException ||
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      throw new Error('Failed to create client programming');
    }
  }

  async findAll(id_site?: number) {
    try {
      const response = await this.prisma.clientProgramming.findMany({
        where: {
          id_site,
        },
      });
      if (!response || response.length === 0) {
        return {
          status: 404,
          message: 'Not Found Client Programming',
        };
      }
      return response;
    } catch (error) {
      throw new Error('Failed to fetch client programming');
    }
  }

  async findOne(id: number, id_site?: number) {
    try {
      const response = await this.prisma.clientProgramming.findUnique({
        where: {
          id,
        },
      });
      if (!response || Object.keys(response).length === 0) {
        return {
          status: 404,
          message: 'Not Found Client Programming',
        };
      }
      // Validar que pertenezca al site del usuario si se proporciona
      if (id_site !== null && id_site !== undefined && response.id_site !== id_site) {
        return {
          status: 403,
          message: 'No tienes permiso para acceder a esta programación',
        };
      }
      return response;
    } catch (error) {
      throw new Error('Failed to fetch client programming');
    }
  }

  async findAllFiltered(filters: FilterClientProgrammingDto, id_site?: number) {
    try {
      // Construir el objeto where dinámicamente
      const whereConditions: any = {};

      // Filtro por fecha de inicio
      if (filters.dateStart) {
        whereConditions.dateStart = filters.dateStart;
      }

      if (filters.status) {
        whereConditions.status = filters.status[0];
      }

      if (id_site !== undefined) {
        whereConditions.id_site = id_site;
      }
      //  else {
      //   // Por defecto solo traer UNASSIGNED
      //   whereConditions.status = StatusComplete.UNASSIGNED;
      // }

      // Filtro por texto de búsqueda
      if (filters.search) {
        whereConditions.OR = [
          { service: { contains: filters.search, mode: 'insensitive' } },
          { client: { contains: filters.search, mode: 'insensitive' } },
          { ubication: { contains: filters.search, mode: 'insensitive' } },
        ];
      }

      const response = await this.prisma.clientProgramming.findMany({
        where: whereConditions,
        orderBy: [{ dateStart: 'asc' }],
      });

      if (!response || response.length === 0) {
        return {
          status: 404,
          message: 'No client programming found with the specified filters',
          filters: filters,
          count: 0,
          data: [],
        };
      }

      return response;
    } catch (error) {
      console.error('Error filtering client programming:', error);
      throw new Error('Failed to filter client programming');
    }
  }

  async update(
    id: number,
    updateClientProgrammingDto: UpdateClientProgrammingDto,
    role?: string,
    siteId?: number,
    subsiteId?: number,
  ) {
    try {
      const validateId = await this.findOne(id);
      if (validateId && 'status' in validateId && validateId.status === 404) {
        return validateId;
      }

      const existing = validateId as any;
      const { status: newStatus, id_operation, force_assign, id: _bodyId, ...rest } =
        updateClientProgrammingDto as any;
      const currentStatus = existing.status;

      // Si la programación está COMPLETED no se puede cambiar su status
      const dataToUpdate =
        currentStatus === 'COMPLETED'
          ? rest
          : { ...rest, ...(newStatus !== undefined && { status: newStatus }) };

      // Validación especial al cambiar a ASSIGNED desde UNASSIGNED o INCOMPLETE
      if (
        newStatus === 'ASSIGNED' &&
        (currentStatus === 'UNASSIGNED' || currentStatus === 'INCOMPLETE')
      ) {
        // 1. Solo ADMIN o SUPERADMIN pueden asignar
        if (role !== 'ADMIN' && role !== 'SUPERADMIN') {
          throw new ForbiddenException(
            'Solo usuarios con rol ADMIN o SUPERADMIN pueden asignar una programación de cliente',
          );
        }

        // 2. id_operation es obligatorio y debe ser un INT4 válido
        if (!id_operation) {
          throw new BadRequestException(
            'Se debe proporcionar id_operation al cambiar el estado a ASSIGNED',
          );
        }
        if (!Number.isInteger(id_operation) || id_operation < 1 || id_operation > 2147483647) {
          throw new BadRequestException(
            `id_operation "${id_operation}" no es un ID de operación válido`,
          );
        }

        // 3. Verificar que la operación existe
        const operation = await this.prisma.operation.findUnique({
          where: { id: id_operation },
        });
        if (!operation) {
          throw new NotFoundException(
            `Operación con ID ${id_operation} no encontrada`,
          );
        }

        // 4. Verificar que la operación pertenece al mismo site
        if (operation.id_site !== existing.id_site) {
          throw new ConflictException(
            `La operación #${id_operation} pertenece al sitio ${operation.id_site}, ` +
            `pero la programación pertenece al sitio ${existing.id_site}`,
          );
        }

        // 5. Verificar subsite
        const progSubsite = existing.id_subsite ?? subsiteId;
        if (
          progSubsite !== null &&
          progSubsite !== undefined &&
          operation.id_subsite !== progSubsite
        ) {
          throw new ConflictException(
            `La operación #${id_operation} pertenece al subsitio #${operation.id_subsite}, ` +
            `pero la programación pertenece al subsitio #${progSubsite}`,
          );
        }

        // 6. Si la operación ya tiene una programación asignada, exigir confirmación explícita
        if (
          operation.id_clientProgramming !== null &&
          operation.id_clientProgramming !== undefined
        ) {
          if (!force_assign) {
            throw new ConflictException({
              requiresConfirmation: true,
              message:
                `La operación #${id_operation} ya tiene asignada la programación ` +
                `#${operation.id_clientProgramming}. ` +
                `Para confirmar la reasignación envíe force_assign: true.`,
            });
          }
        }

        // 7. Si la operación está COMPLETED, validar que la fecha y hora de la
        //    programación estén dentro del rango de inicio/fin de esa operación
        if (operation.status === 'COMPLETED') {
          const toDateOnly = (d: Date) => {
            const dt = new Date(d);
            dt.setUTCHours(0, 0, 0, 0);
            return dt;
          };

          const progDate = toDateOnly((rest as any).dateStart ?? existing.dateStart);
          const opDateStart = toDateOnly(operation.dateStart);
          const opDateEnd = operation.dateEnd
            ? toDateOnly(operation.dateEnd)
            : opDateStart;

          const timeToMinutes = (t: string) => {
            const [h, m] = t.split(':').map(Number);
            return h * 60 + m;
          };

          const progTime: string = (rest as any).timeStart ?? existing.timeStart;
          const progMinutes = timeToMinutes(progTime);
          const opTimeStartMin = timeToMinutes(operation.timeStrat);
          const opTimeEndMin = operation.timeEnd
            ? timeToMinutes(operation.timeEnd)
            : opTimeStartMin;
          const opTimeRange =
            `${operation.timeStrat} – ${operation.timeEnd ?? operation.timeStrat}`;
          const opDateRange =
            `${opDateStart.toISOString().split('T')[0]} – ${opDateEnd.toISOString().split('T')[0]}`;

          if (progDate < opDateStart || progDate > opDateEnd) {
            throw new ConflictException(
              `La fecha de la programación (${progDate.toISOString().split('T')[0]}) está fuera del rango de la operación. ` +
              `Rango de fechas permitido: ${opDateRange}. ` +
              `Rango horario de la operación: ${opTimeRange}. ` +
              `Ajuste la fecha y/o la hora para que coincidan con la operación.`,
            );
          }

          if (progMinutes < opTimeStartMin || progMinutes > opTimeEndMin) {
            throw new ConflictException(
              `La hora de la programación (${progTime}) está fuera del rango horario de la operación. ` +
              `Rango horario permitido: ${opTimeRange}. ` +
              `Rango de fechas de la operación: ${opDateRange}. ` +
              `Ajuste la hora para que coincida con la operación.`,
            );
          }
        }

        // 8. Vincular la operación con esta programación
        await this.prisma.operation.update({
          where: { id: id_operation },
          data: { id_clientProgramming: id },
        });

        // Si la operación ya está COMPLETED, la programación también queda COMPLETED
        if (operation.status === 'COMPLETED') {
          dataToUpdate.status = 'COMPLETED';
        }
      }

      const response = await this.prisma.clientProgramming.update({
        where: {
          id,
        },
        data: dataToUpdate,
      });
      return response;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ForbiddenException ||
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      throw new Error('Failed to update client programming');
    }
  }

  async remove(id: number, id_site?: number) {
    try {
      const validateId = await this.findOne(id);
      if (validateId && 'status' in validateId && validateId.status === 404) {
        return validateId;
      }
      // Validar que el usuario tenga permiso en ese site
      if (id_site !== null && id_site !== undefined) {
        const validateSite = validateId['id_site'];
        if (validateSite !== id_site) {
          return {
            message: 'Not authorized to delete this client programming',
            status: 403,
          };
        }
      }
      const response = await this.prisma.clientProgramming.delete({
        where: { id },
      });
      return response;
    } catch (error) {
      throw new Error('Failed to delete client programming');
    }
  }

  async assignToOperation(id: number, id_operation: number, id_site?: number) {
    try {
      // Verificar que la programación existe y pertenece al site
      const existing = await this.findOne(id, id_site);
      if (existing && 'message' in existing) {
        return existing;
      }

      // Verificar que la operación existe
      const operation = await this.prisma.operation.findUnique({
        where: { id: id_operation },
        select: { id: true, id_site: true, id_clientProgramming: true },
      });
      if (!operation) {
        return { message: `Operación con ID ${id_operation} no encontrada`, status: 404 };
      }

      // Validar que la operación pertenece al mismo site
      if (id_site !== undefined && id_site !== null && operation.id_site !== id_site) {
        return { message: 'No autorizado para asignar a esta operación', status: 403 };
      }

      // Ejecutar ambas actualizaciones en una transacción
      const [updatedProgramming] = await this.prisma.$transaction([
        this.prisma.clientProgramming.update({
          where: { id },
          data: { status: 'ASSIGNED' },
        }),
        this.prisma.operation.update({
          where: { id: id_operation },
          data: { id_clientProgramming: id },
        }),
      ]);

      return updatedProgramming;
    } catch (error) {
      throw new Error('Failed to assign client programming to operation');
    }
  }
}
