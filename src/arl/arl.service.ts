import { Injectable } from '@nestjs/common';
import { Prisma, StatusActivation } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateArlDto } from './dto/create-arl.dto';
import { UpdateArlDto } from './dto/update-arl.dto';

@Injectable()
export class ArlService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Busca otra ARL con el mismo nombre o NIT. Se valida ANTES de insertar
   * para que un duplicado nunca llegue a la BD: un INSERT fallido consume
   * un valor de la secuencia y deja huecos en los id.
   */
  private async findDuplicate(
    tx: Prisma.TransactionClient,
    dto: CreateArlDto | UpdateArlDto,
    excludeId?: number,
  ) {
    const or: Prisma.ArlWhereInput[] = [];
    if (dto.name) or.push({ name: dto.name });
    if (dto.nit) or.push({ nit: dto.nit });
    if (or.length === 0) return null;

    const existing = await tx.arl.findFirst({
      where: { OR: or, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    });
    if (!existing) return null;

    const field = dto.name && existing.name === dto.name ? 'name' : 'nit';
    return {
      message: `ARL with ${field} '${dto[field]}' already exists`,
      status: 409,
    };
  }

  /**
   * Bloquea la tabla para escritura durante la transacción, de modo que dos
   * registros simultáneos con el mismo nombre/NIT no pasen ambos la validación.
   */
  private lockTable(tx: Prisma.TransactionClient) {
    return tx.$executeRaw`LOCK TABLE "Arl" IN SHARE ROW EXCLUSIVE MODE`;
  }

  async create(createArlDto: CreateArlDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockTable(tx);
        const duplicate = await this.findDuplicate(tx, createArlDto);
        if (duplicate) return duplicate;
        return tx.arl.create({ data: createArlDto });
      });
    } catch (error) {
      throw new Error(`Error creating ARL: ${error}`);
    }
  }

  async findAll(status?: StatusActivation) {
    try {
      return await this.prisma.arl.findMany({
        where: status ? { status } : undefined,
        orderBy: { name: 'asc' },
      });
    } catch (error) {
      throw new Error(`Error fetching ARL: ${error}`);
    }
  }

  async findOne(id: number) {
    try {
      const response = await this.prisma.arl.findUnique({ where: { id } });
      if (!response) {
        return { status: 404, message: `ARL with id ${id} not found` };
      }
      return response;
    } catch (error) {
      throw new Error(`Error fetching ARL with id ${id}: ${error}`);
    }
  }

  async update(id: number, updateArlDto: UpdateArlDto) {
    try {
      const validateID = await this.findOne(id);
      if (validateID['status'] === 404) {
        return validateID;
      }
      return await this.prisma.$transaction(async (tx) => {
        await this.lockTable(tx);
        const duplicate = await this.findDuplicate(tx, updateArlDto, id);
        if (duplicate) return duplicate;
        return tx.arl.update({ where: { id }, data: updateArlDto });
      });
    } catch (error) {
      throw new Error(`Error updating ARL with id ${id}: ${error}`);
    }
  }

  async remove(id: number) {
    try {
      const validateID = await this.findOne(id);
      if (validateID['status'] === 404) {
        return validateID;
      }
      return await this.prisma.arl.delete({ where: { id } });
    } catch (error) {
      // Referenciada por trabajadores o incapacidades: se debe inactivar
      if (error.code === 'P2003') {
        return {
          message: 'ARL is in use and cannot be deleted; set it to INACTIVE instead',
          status: 409,
        };
      }
      throw new Error(`Error removing ARL with id ${id}: ${error}`);
    }
  }
}
