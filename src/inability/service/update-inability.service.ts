import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { getColombianDateTime, getColombianEndOfDay, getColombianStartOfDay, getColombianTimeString } from 'src/common/utils/dateColombia';

@Injectable()
export class UpdateInabilityService {
  private readonly logger = new Logger(UpdateInabilityService.name);

  constructor(private prisma: PrismaService) {}

  async updateWorkersWithExpiredInabilities() {
    const now = getColombianDateTime();
    const today = now.toISOString().split('T')[0];
    const currentTime = getColombianTimeString();

    const startOfDay = getColombianStartOfDay(now);
    const endOfDay = getColombianEndOfDay(now);


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

      // Extraer YYYY-MM-DD de la fecha devuelta por Prisma
      let y: number, m: number, d: number;
      try {
        let dateStr: string;
        if (inability.dateDisableEnd instanceof Date) {
          dateStr = inability.dateDisableEnd.toISOString().slice(0, 10);
        } else {
          dateStr = String(inability.dateDisableEnd).slice(0, 10);
        }
        
        const parts = dateStr.split('-').map(Number);
        y = parts[0];
        m = parts[1];
        d = parts[2];
      } catch (err) {
        this.logger.error(`❌ Error normalizing date for worker ${inability.id_worker}:`, err);
        continue;
      }

      // ✅ CLAVE: Construir la fecha de manera consistente con getColombianDateTime()
      const tempEndDate = new Date(y, m - 1, d, 0, 0, 0, 0);
      const endDateInColombiaLocale = new Date(
        tempEndDate.toLocaleString('en-US', { timeZone: 'America/Bogota' }),
      );

      const endDateOnly = new Date(
        endDateInColombiaLocale.getFullYear(),
        endDateInColombiaLocale.getMonth(),
        endDateInColombiaLocale.getDate(),
        0, 0, 0, 0
      );

      const startOfDayTime = startOfDay.getTime();
      const endDateTime = endDateOnly.getTime();

      this.logger.log(`👤 Worker ${inability.id_worker}: dateDisableEnd=${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}, endDateOnly=${endDateOnly.toLocaleString('sv-SE')}, startOfDay=${startOfDay.toLocaleString('sv-SE')}`);

      // Si la fecha de fin es anterior a hoy, ya está vencida
      if (endDateTime < startOfDayTime) {
        expiredWorkerIds.push(inability.id_worker);
        // this.logger.log(`✅ Worker ${inability.id_worker}: Inability EXPIRED (date is before today)`);
      } else if (endDateTime === startOfDayTime) {
        // Si es exactamente hoy, también se considera vencida (el permiso/incapacidad terminó)
        expiredWorkerIds.push(inability.id_worker);
        // this.logger.log(`✅ Worker ${inability.id_worker}: Inability EXPIRED (date is today)`);
      } else {
        // this.logger.log(`⏳ Worker ${inability.id_worker}: Inability NOT yet expired (expires in ${endDateTime - startOfDayTime}ms at ${endDateOnly.toLocaleString('sv-SE')})`);
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
      // this.logger.log(`✔️ Updated ${workerIds.length} workers to AVALIABLE due to expired inabilities`);
    } else {
      this.logger.log(`ℹ️ No expired inabilities found`);
    }
  }
}