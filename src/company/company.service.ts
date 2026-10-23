import { Injectable } from '@nestjs/common';
import { Prisma, StatusActivation } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

const COMPANY_INCLUDE = {
  arl: { select: { id: true, name: true, nit: true } },
} satisfies Prisma.CompanyInclude;

@Injectable()
export class CompanyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Busca otra empresa con el mismo nombre o NIT. Se valida ANTES de insertar
   * para que un duplicado nunca llegue a la BD: un INSERT fallido consume
   * un valor de la secuencia y deja huecos en los id.
   */
  private async findDuplicate(
    tx: Prisma.TransactionClient,
    dto: CreateCompanyDto | UpdateCompanyDto,
    excludeId?: number,
  ) {
    const or: Prisma.CompanyWhereInput[] = [];
    if (dto.name) or.push({ name: dto.name });
    if (dto.nit) or.push({ nit: dto.nit });
    if (or.length === 0) return null;

    const existing = await tx.company.findFirst({
      where: { OR: or, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    });
    if (!existing) return null;

    const field = dto.name && existing.name === dto.name ? 'name' : 'nit';
    return {
      message: `Company with ${field} '${dto[field]}' already exists`,
      status: 409,
    };
  }

  /**
   * Valida la ARL antes de escribir: un id inexistente haría fallar el INSERT
   * por la FK (consumiendo un id) y una ARL inactiva no se puede asignar.
   */
  private async validateArl(
    tx: Prisma.TransactionClient,
    id_arl: number | null | undefined,
  ) {
    if (id_arl === undefined || id_arl === null) return null;
    const arl = await tx.arl.findUnique({ where: { id: id_arl } });
    if (!arl) {
      return { status: 404, message: `ARL with id ${id_arl} not found` };
    }
    if (arl.status !== StatusActivation.ACTIVE) {
      return { status: 400, message: `ARL with id ${id_arl} is not ACTIVE` };
    }
    return null;
  }

  /**
   * Bloquea la tabla para escritura durante la transacción, de modo que dos
   * registros simultáneos con el mismo nombre/NIT no pasen ambos la validación.
   */
  private lockTable(tx: Prisma.TransactionClient) {
    return tx.$executeRaw`LOCK TABLE "Company" IN SHARE ROW EXCLUSIVE MODE`;
  }

  async create(createCompanyDto: CreateCompanyDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockTable(tx);
        const invalid =
          (await this.findDuplicate(tx, createCompanyDto)) ??
          (await this.validateArl(tx, createCompanyDto.id_arl));
        if (invalid) return invalid;
        return tx.company.create({
          data: createCompanyDto,
          include: COMPANY_INCLUDE,
        });
      });
    } catch (error) {
      throw new Error(`Error creating company: ${error}`);
    }
  }

  async findAll(status?: StatusActivation) {
    try {
      return await this.prisma.company.findMany({
        where: status ? { status } : undefined,
        include: COMPANY_INCLUDE,
        orderBy: { name: 'asc' },
      });
    } catch (error) {
      throw new Error(`Error fetching company: ${error}`);
    }
  }

  async findOne(id: number) {
    try {
      const response = await this.prisma.company.findUnique({
        where: { id },
        include: COMPANY_INCLUDE,
      });
      if (!response) {
        return { status: 404, message: `Company with id ${id} not found` };
      }
      return response;
    } catch (error) {
      throw new Error(`Error fetching company with id ${id}: ${error}`);
    }
  }

  async update(id: number, updateCompanyDto: UpdateCompanyDto) {
    try {
      const validateID = await this.findOne(id);
      if (validateID['status'] === 404) {
        return validateID;
      }
      return await this.prisma.$transaction(async (tx) => {
        await this.lockTable(tx);
        const invalid =
          (await this.findDuplicate(tx, updateCompanyDto, id)) ??
          (await this.validateArl(tx, updateCompanyDto.id_arl));
        if (invalid) return invalid;
        return tx.company.update({
          where: { id },
          data: updateCompanyDto,
          include: COMPANY_INCLUDE,
        });
      });
    } catch (error) {
      throw new Error(`Error updating company with id ${id}: ${error}`);
    }
  }

  async remove(id: number) {
    try {
      const validateID = await this.findOne(id);
      if (validateID['status'] === 404) {
        return validateID;
      }
      return await this.prisma.company.delete({ where: { id } });
    } catch (error) {
      // Referenciada por contratos o incapacidades: se debe inactivar
      if (error.code === 'P2003') {
        return {
          message: 'Company is in use and cannot be deleted; set it to INACTIVE instead',
          status: 409,
        };
      }
      throw new Error(`Error removing company with id ${id}: ${error}`);
    }
  }
}
