import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
@Injectable()
export class UpdateOperationWorkerService {
  private readonly logger = new Logger(UpdateOperationWorkerService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Actualiza el estado de los trabajadores según su programación
   * Toda la lógica se ejecuta en la base de datos (PostgreSQL)
   */
  async updateWorkersScheduleState(): Promise<void> {
     
     //  1. LIBERAR TODO SI LA OPERACIÓN TERMINÓ
  await this.prisma.$executeRawUnsafe(`
    UPDATE "Worker" w
    SET status = 'AVALIABLE'
    FROM "Operation_Worker" ow
    INNER JOIN "Operation" o ON o.id = ow.id_operation
    WHERE
      w.id = ow.id_worker
      AND o.status = 'COMPLETED'
      AND w.status = 'ASSIGNED';
  `);

    // 2. Liberar trabajadores cuyo turno terminó
    await this.prisma.$executeRawUnsafe(`
      UPDATE "Worker" w
      SET status = 'AVALIABLE'
      FROM "Operation_Worker" ow
      INNER JOIN "Operation" o ON o.id = ow.id_operation
      WHERE
        w.id = ow.id_worker
        AND w.status = 'ASSIGNED'
        AND o.status = 'INPROGRESS'
        AND (
          (ow."dateEnd" < (CURRENT_DATE AT TIME ZONE 'America/Bogota'))
          OR
          (ow."dateEnd" = (CURRENT_DATE AT TIME ZONE 'America/Bogota')
            AND (
              (CAST(split_part(ow."timeEnd", ':', 1) AS INTEGER) * 60 + CAST(split_part(ow."timeEnd", ':', 2) AS INTEGER)) <
              (EXTRACT(HOUR FROM (CURRENT_TIME AT TIME ZONE 'America/Bogota')) * 60 + EXTRACT(MINUTE FROM (CURRENT_TIME AT TIME ZONE 'America/Bogota')))
            )
          )
        );
    `);

    // 3. Asignar trabajadores cuyo turno debe iniciar (regla de 10 minutos)
    await this.prisma.$executeRawUnsafe(`
      UPDATE "Worker" w
      SET status = 'ASSIGNED'
      FROM "Operation_Worker" ow
      INNER JOIN "Operation" o ON o.id = ow.id_operation
      WHERE
        w.id = ow.id_worker
        AND w.status = 'AVALIABLE'
        AND o.status = 'INPROGRESS'
        AND ow."dateStart" = (CURRENT_DATE AT TIME ZONE 'America/Bogota')
        AND (
          (EXTRACT(HOUR FROM (CURRENT_TIME AT TIME ZONE 'America/Bogota')) * 60 + EXTRACT(MINUTE FROM (CURRENT_TIME AT TIME ZONE 'America/Bogota')))
          - (CAST(split_part(ow."timeStart", ':', 1) AS INTEGER) * 60 + CAST(split_part(ow."timeStart", ':', 2) AS INTEGER))
        ) BETWEEN 0 AND 10
    `);
  }
}