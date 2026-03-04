import { Injectable } from '@nestjs/common';
import { CreateInabilityDto } from './dto/create-inability.dto';
import { UpdateInabilityDto } from './dto/update-inability.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { ValidationService } from 'src/common/validation/validation.service';
import { FilterInabilityDto } from './dto/filter-inability';

@Injectable()
export class InabilityService {
  constructor(
    private prisma: PrismaService,
    private validate: ValidationService,
  ) {}

  async create(createInabilityDto: CreateInabilityDto, id_site?: number) {
    try {
      const validation = await this.validate.validateAllIds({
        workerIds: [createInabilityDto.id_worker],
      });
      if (validation && 'status' in validation && validation.status === 404) {
        return validation;
      }
      if (id_site !== undefined) {
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
      data: { 
        ...createInabilityDto,
        // Asegurar que las fechas se guarden solo con la fecha (sin hora)
        // dateDisableStart: new Date(createInabilityDto.dateDisableStart).toISOString().split('T')[0],
        // dateDisableEnd: new Date(createInabilityDto.dateDisableEnd).toISOString().split('T')[0],
      },
    });

    // Actualizar el estado del trabajador a DISABLE
    await this.prisma.worker.update({
      where: { id: createInabilityDto.id_worker },
      data: { status: 'DISABLE' },
    });

      return response;
    } catch (error) {
      throw new Error(`Error creating inability: ${error}`);
    }
  }

  async findAll(id_site?: number) {
    try {
      const response = await this.prisma.inability.findMany({
        where: {
          worker:{id_site}
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
      if (!response || response.length === 0) {
        return { status: 404, message: 'No inabilities found' };
      }
      return response;
    } catch (error) {
      throw new Error(`Error finding all inabilities: ${error}`);
    }
  }

  async findOne(id: number, id_site?: number) {
    try {
      const response = await this.prisma.inability.findUnique({
        where: { id, worker: { id_site } },
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
      if (!response) {
        return { status: 404, message: `Inability with id ${id} not found` };
      }
      return response;
    } catch (error) {
      throw new Error(`Error finding inability with id ${id}: ${error}`);
    }
  }

  async findByDni(dni: string, id_site?: number) {
    try {
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

  async update(id: number, updateInabilityDto: UpdateInabilityDto, id_site?: number) {
    try {
      const validation = await this.findOne(id);
      if (validation['status'] != undefined) {
        return validation;
      }
      if (id_site !== undefined) {
        const workerValidation = await this.validate.validateAllIds({
          workerIds: [validation['id_worker']],
        });
        if (workerValidation && workerValidation.id_site !== id_site) {
          return {
            message: 'Not authorized to update inability for this worker',
            status: 409,
          };
        }
      }
      const response = await this.prisma.inability.update({
        where: { id },
        data: { ...updateInabilityDto },
      });
      return response;
    } catch (error) {
      throw new Error(`Error updating inability with id ${id}: ${error}`);
    }
  }

  async remove(id: number, id_site?: number) {
    try {
      const validation = await this.findOne(id);
      if (validation['status'] != undefined) {
        return validation;
      }
      if (id_site !== undefined) {
        const workerValidation = await this.validate.validateAllIds({
          workerIds: [validation['id_worker']],
        });
        if (workerValidation && workerValidation.id_site !== id_site) {
          return {
            message: 'Not authorized to remove inability for this worker',
            status: 409,
          };
        }
      }
      const response = await this.prisma.inability.delete({
        where: { id },
      });
      return response;
    } catch (error) {
      throw new Error(`Error removing inability with id ${id}: ${error}`);
    }
  }
}
