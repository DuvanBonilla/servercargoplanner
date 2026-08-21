import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { getColombianDateTime, getColombianEndOfDay, getColombianStartOfDay, getColombianTimeString } from 'src/common/utils/dateColombia';

@Injectable()
export class UpdateInabilityService {
  private readonly logger = new Logger(UpdateInabilityService.name);

  constructor(private prisma: PrismaService) {}

  async updateWorkersWithExpiredInabilities() {
    const now = getColombianDateTime();
    const currentTime = getColombianTimeString();

    const startOfDay = getColombianStartOfDay(now);
    const endOfDay = getColombianEndOfDay(now);

    this.logger.log(
      `🕐 Running expired-inability check at ${currentTime} (Colombia) | startOfDay=${startOfDay.toISOString()} endOfDay=${endOfDay.toISOString()}`,
    );

    // Buscar incapacidades cuya fecha de fin sea <= hoy
    const candidates = await this.prisma.inability.findMany({
      where: {
        dateDisableEnd: { lte: endOfDay },
      },
      select: { id_worker: true, dateDisableEnd: true },
    });

    this.logger.log(`📋 Found ${candidates.length} inability candidates`);

    const expiredWorkerIds: number[] = [];

    for (const inability of candidates) {
      if (!inability.dateDisableEnd) continue;

      try {
        // ✅ Fecha fin de incapacidad
        const endDateOnly = new Date(inability.dateDisableEnd);

        // ✅ Normalizar a inicio del día
        endDateOnly.setHours(0, 0, 0, 0);

        // ✅ Inicio del día actual en Colombia
        const startOfDayTime = startOfDay.getTime();

        // ✅ Fecha fin incapacidad
        const endDateTime = endDateOnly.getTime();

        this.logger.log(
          `👤 Worker ${inability.id_worker}: endDate=${endDateOnly.toLocaleString('sv-SE')} | startOfDay=${startOfDay.toLocaleString('sv-SE')}`,
        );

        // ✅ Si la incapacidad terminó hoy o antes
        if (endDateTime < startOfDayTime) {
          expiredWorkerIds.push(inability.id_worker);
          this.logger.log(`✅ Worker ${inability.id_worker}: Inability EXPIRED`);
        } else {
          this.logger.log(`⏳ Worker ${inability.id_worker}: Inability NOT expired`);
        }
      } catch (err) {
        this.logger.error(
          `❌ Error processing inability for worker ${inability.id_worker}:`,
          err,
        );
      }
    }

    const workerIds = Array.from(new Set(expiredWorkerIds));

    if (workerIds.length > 0) {
      await this.prisma.worker.updateMany({
        where: { id: { in: workerIds }, status: 'DISABLE' },
        data: {
          status: 'AVALIABLE',
          dateDisableStart: null,
          dateDisableEnd: null,
        },
      });
      this.logger.log(`✔️ Updated ${workerIds.length} workers to AVALIABLE due to expired inabilities`);
    } else {
      this.logger.log(`ℹ️ No expired inabilities found`);
    }
  }
}
