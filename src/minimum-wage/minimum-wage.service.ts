import { Injectable } from '@nestjs/common';
import { MinimumWage, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateMinimumWageDto, UpdateMinimumWageDto } from './dto/create-minimum-wage.dto';

/** El IBC se liquida sobre 30 días por mes */
const DAYS_PER_MONTH = 30;

@Injectable()
export class MinimumWageService {
  constructor(private readonly prisma: PrismaService) {}

  /** Agrega el valor diario (base mínima diaria del IBC) */
  private withDaily(wage: MinimumWage) {
    return { ...wage, dailyValue: wage.value / DAYS_PER_MONTH };
  }

  /**
   * Bloquea la tabla y valida el año ANTES de escribir, para que un año
   * duplicado nunca llegue a la BD (un INSERT fallido consume un id).
   */
  private async findDuplicateYear(tx: Prisma.TransactionClient, year: number, excludeId?: number) {
    await tx.$executeRaw`LOCK TABLE "MinimumWage" IN SHARE ROW EXCLUSIVE MODE`;
    const existing = await tx.minimumWage.findFirst({
      where: { year, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    });
    return existing
      ? { status: 409, message: `Minimum wage for year ${year} already exists` }
      : null;
  }

  async create(dto: CreateMinimumWageDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const duplicate = await this.findDuplicateYear(tx, dto.year);
        if (duplicate) return duplicate;
        return this.withDaily(await tx.minimumWage.create({ data: dto }));
      });
    } catch (error) {
      throw new Error(`Error creating minimum wage: ${error}`);
    }
  }

  async findAll() {
    try {
      const wages = await this.prisma.minimumWage.findMany({ orderBy: { year: 'desc' } });
      return wages.map((w) => this.withDaily(w));
    } catch (error) {
      throw new Error(`Error fetching minimum wages: ${error}`);
    }
  }

  /** SMMLV de un año: base mínima del IBC de las incapacidades de ese año */
  async findByYear(year: number) {
    try {
      const wage = await this.prisma.minimumWage.findUnique({ where: { year } });
      if (!wage) {
        return { status: 404, message: `Minimum wage for year ${year} not found` };
      }
      return this.withDaily(wage);
    } catch (error) {
      throw new Error(`Error fetching minimum wage for year ${year}: ${error}`);
    }
  }

  async update(id: number, dto: UpdateMinimumWageDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const wage = await tx.minimumWage.findUnique({ where: { id } });
        if (!wage) {
          return { status: 404, message: `Minimum wage with id ${id} not found` };
        }
        if (dto.year !== undefined && dto.year !== wage.year) {
          const duplicate = await this.findDuplicateYear(tx, dto.year, id);
          if (duplicate) return duplicate;
        }
        return this.withDaily(await tx.minimumWage.update({ where: { id }, data: dto }));
      });
    } catch (error) {
      throw new Error(`Error updating minimum wage with id ${id}: ${error}`);
    }
  }

  async remove(id: number) {
    try {
      const wage = await this.prisma.minimumWage.findUnique({ where: { id } });
      if (!wage) {
        return { status: 404, message: `Minimum wage with id ${id} not found` };
      }
      return this.withDaily(await this.prisma.minimumWage.delete({ where: { id } }));
    } catch (error) {
      throw new Error(`Error removing minimum wage with id ${id}: ${error}`);
    }
  }
}
