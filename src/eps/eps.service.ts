import { Injectable } from '@nestjs/common';
import { Prisma, StatusActivation } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateEpsDto } from './dto/create-eps.dto';
import { UpdateEpsDto } from './dto/update-eps.dto';

@Injectable()
export class EpsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Busca otra EPS con el mismo nombre o NIT. Se valida ANTES de insertar
   * para que un duplicado nunca llegue a la BD: un INSERT fallido consume
   * un valor de la secuencia y deja huecos en los id.
   */
  private async findDuplicate(
    tx: Prisma.TransactionClient,
    dto: CreateEpsDto | UpdateEpsDto,
    excludeId?: number,
  ) {
    const or: Prisma.EpsWhereInput[] = [];
    if (dto.name) or.push({ name: dto.name });
    if (dto.nit) or.push({ nit: dto.nit });
    if (or.length === 0) return null;

    const existing = await tx.eps.findFirst({
      where: { OR: or, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    });
    if (!existing) return null;

    const field = dto.name && existing.name === dto.name ? 'name' : 'nit';
    return {
      message: `EPS with ${field} '${dto[field]}' already exists`,
      status: 409,
    };
  }

  /**
   * Bloquea la tabla para escritura durante la transacción, de modo que dos
   * registros simultáneos con el mismo nombre/NIT no pasen ambos la validación.
   */
  private lockTable(tx: Prisma.TransactionClient) {
    return tx.$executeRaw`LOCK TABLE "Eps" IN SHARE ROW EXCLUSIVE MODE`;
  }

  async create(createEpsDto: CreateEpsDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockTable(tx);
        const duplicate = await this.findDuplicate(tx, createEpsDto);
        if (duplicate) return duplicate;
        return tx.eps.create({ data: createEpsDto });
      });
    } catch (error) {
      throw new Error(`Error creating EPS: ${error}`);
    }
  }

  async findAll(status?: StatusActivation) {
    try {
      return await this.prisma.eps.findMany({
        where: status ? { status } : undefined,
        orderBy: { name: 'asc' },
      });
    } catch (error) {
      throw new Error(`Error fetching EPS: ${error}`);
    }
  }

  async findOne(id: number) {
    try {
      const response = await this.prisma.eps.findUnique({ where: { id } });
      if (!response) {
        return { status: 404, message: `EPS with id ${id} not found` };
      }
      return response;
    } catch (error) {
      throw new Error(`Error fetching EPS with id ${id}: ${error}`);
    }
  }

  async update(id: number, updateEpsDto: UpdateEpsDto) {
    try {
      const validateID = await this.findOne(id);
      if (validateID['status'] === 404) {
        return validateID;
      }
      return await this.prisma.$transaction(async (tx) => {
        await this.lockTable(tx);
        const duplicate = await this.findDuplicate(tx, updateEpsDto, id);
        if (duplicate) return duplicate;
        return tx.eps.update({ where: { id }, data: updateEpsDto });
      });
    } catch (error) {
      throw new Error(`Error updating EPS with id ${id}: ${error}`);
    }
  }

  async remove(id: number) {
    try {
      const validateID = await this.findOne(id);
      if (validateID['status'] === 404) {
        return validateID;
      }
      return await this.prisma.eps.delete({ where: { id } });
    } catch (error) {
      // Referenciada por trabajadores o incapacidades: se debe inactivar
      if (error.code === 'P2003') {
        return {
          message: 'EPS is in use and cannot be deleted; set it to INACTIVE instead',
          status: 409,
        };
      }
      throw new Error(`Error removing EPS with id ${id}: ${error}`);
    }
  }
}
