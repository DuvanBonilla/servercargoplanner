import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

// Codigo legible y estable por grupo (id_group) de una operacion, ej. operacion 14379 -> code "1437901", "1437902"...
// Se calcula una sola vez por (id_operation, id_group) y queda fijo para siempre (RTD, Datos, Bill referencian el mismo code).
@Injectable()
export class OperationGroupService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureCode(id_operation: number, id_group?: string | null): Promise<string | null> {
    if (!id_group) return null;

    const existing = await this.prisma.operationGroup.findUnique({
      where: { id_operation_id_group: { id_operation, id_group } },
    });
    if (existing) return existing.code;

    return this.prisma.$transaction(async (tx) => {
      const alias = (await tx.operationGroup.count({ where: { id_operation } })) + 1;
      const code = `${id_operation}${String(alias).padStart(2, '0')}`;

      const created = await tx.operationGroup.upsert({
        where: { id_operation_id_group: { id_operation, id_group } },
        update: {},
        create: { id_operation, id_group, alias, code },
      });

      return created.code;
    });
  }
}
