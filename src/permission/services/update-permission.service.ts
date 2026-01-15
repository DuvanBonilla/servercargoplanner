import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  getColombianDateTime,
  getColombianTimeString,
  getColombianStartOfDay,
  getColombianEndOfDay,
} from 'src/common/utils/dateColombia';


@Injectable()
export class UpdatePermissionService {
  private readonly logger = new Logger(UpdatePermissionService.name);

  constructor(
    private prisma: PrismaService,
  ) {}


    /**
   * Actualiza el estado de los trabajadores cuyo permiso inicia hoy
   */
  async updateWorkersWithStartingPermissions() {
    const now = getColombianDateTime();
    const today = now.toISOString().split('T')[0]; // YYYY-MM-DD

    // Busca permisos que inician hoy
    const startingPermissions = await this.prisma.permission.findMany({
      where: {
        dateDisableStart: new Date(today),
      },
      select: { id_worker: true },
    });

    const workerIds = startingPermissions.map(p => p.id_worker);

    if (workerIds.length > 0) {
      await this.prisma.worker.updateMany({
        where: { id: { in: workerIds } },
        data: { status: 'PERMISSION' },
      });
      // this.logger.log(`Actualizados ${workerIds.length} trabajadores a PERMISSION por permisos que inician hoy`);
    }
  }

  
    /**
   * Actualiza el estado de los trabajadores cuyo permiso vence hoy y la hora ya pasó o es igual
   */

  async updateWorkersWithExpiredPermissions() {
    const now = getColombianDateTime();
    const today = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const currentTime = getColombianTimeString(); // HH:MM

    const startOfDay = getColombianStartOfDay(now);
    const endOfDay = getColombianEndOfDay(now);


    // Traer candidatos cuya fecha de fin sea <= fin del día
    const candidates = await this.prisma.permission.findMany({
      where: {
        dateDisableEnd: { lte: endOfDay },
      },
      select: { id_worker: true, dateDisableEnd: true, timeEnd: true },
    });

    // this.logger.log(`📋 Found ${candidates.length} permission candidates`);

    const expiredWorkerIds: number[] = [];
    for (const p of candidates) {
      if (!p.dateDisableEnd) continue;

      // Extraer YYYY-MM-DD de la fecha devuelta por Prisma
      let y: number, m: number, d: number;
      try {
        let dateStr: string;
        if (p.dateDisableEnd instanceof Date) {
          dateStr = p.dateDisableEnd.toISOString().slice(0, 10);
        } else {
          dateStr = String(p.dateDisableEnd).slice(0, 10);
        }
        
        const parts = dateStr.split('-').map(Number);
        y = parts[0];
        m = parts[1];
        d = parts[2];
      } catch (err) {
        this.logger.error(`❌ Error normalizing date for worker ${p.id_worker}:`, err);
        continue;
      }

      // ✅ CLAVE: Construir la fecha de expiración EXACTAMENTE igual a como se construye now en getColombianDateTime()
      // Convertir a locale string y volver a crear Date para que esté en la misma base de referencia
      const tempExpireDate = new Date(y, m - 1, d, 0, 0, 0, 0);
      const expireDateInColombiaLocale = new Date(
        tempExpireDate.toLocaleString('en-US', { timeZone: 'America/Bogota' }),
      );

      // Si la fecha de fin es anterior a hoy -> expirado
      const expireDateOnly = new Date(
        expireDateInColombiaLocale.getFullYear(),
        expireDateInColombiaLocale.getMonth(),
        expireDateInColombiaLocale.getDate(),
        0, 0, 0, 0
      );

      const startOfDayTime = startOfDay.getTime();
      
      // this.logger.debug(`Worker ${p.id_worker}: dateDisableEnd=${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}, expireDateOnly=${expireDateOnly.toLocaleString('sv-SE')}, startOfDay=${startOfDay.toLocaleString('sv-SE')}`);

      if (expireDateOnly.getTime() < startOfDayTime) {
        expiredWorkerIds.push(p.id_worker);
        // this.logger.log(`✅ Worker ${p.id_worker}: Permission EXPIRED (date is before today)`);
        continue;
      }

      // Si la fecha es hoy, comparar hora
      const timeStr = p.timeEnd || '23:59';
      const [hhRaw, mmRaw] = timeStr.split(':');
      const hh = Number(hhRaw) || 23;
      const mm = Number(mmRaw) || 59;

      // Construir el datetime de expiración usando la MISMA técnica que getColombianDateTime()
      const tempExpireDateTime = new Date(y, m - 1, d, hh, mm, 0, 0);
      const expireDateTime = new Date(
        tempExpireDateTime.toLocaleString('en-US', { timeZone: 'America/Bogota' }),
      );

      const expireTime = expireDateTime.getTime();
      const nowTime = now.getTime();

      // this.logger.log(`👤 Worker ${p.id_worker}: timeEnd=${p.timeEnd}, expireDateTime=${expireDateTime.toLocaleString('sv-SE')}, now=${now.toLocaleString('sv-SE')}, diff=${expireTime - nowTime}ms`);

      if (expireTime <= nowTime) {
        expiredWorkerIds.push(p.id_worker);
        // this.logger.log(`✅ Worker ${p.id_worker}: Permission EXPIRED at ${expireDateTime.toLocaleString('sv-SE')}`);
      } else {
        // this.logger.log(`⏳ Worker ${p.id_worker}: Permission NOT yet expired (expires in ${expireTime - nowTime}ms at ${expireDateTime.toLocaleString('sv-SE')})`);
      }
    }

    const workerIds = Array.from(new Set(expiredWorkerIds));

    if (workerIds.length > 0) {
      await this.prisma.worker.updateMany({
        where: { id: { in: workerIds }, status: 'PERMISSION' },
        data: {
          status: 'AVALIABLE',
          dateDisableStart: null,
          dateDisableEnd: null,
        },
      });
      // this.logger.log(`✔️ Updated ${workerIds.length} workers to AVALIABLE`);
    } else {
      // this.logger.log(`ℹ️ No expired permissions found`); 
    }
  }
}