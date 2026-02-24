import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      log: ['error'],
      datasources: {
        db: { url: process.env.DATABASE_URL },
      },
      // 🚀 OPTIMIZACIÓN: Configuración del connection pool para mejor rendimiento
      transactionOptions: {
        maxWait: 5000, // Tiempo máximo de espera para obtener una conexión (5s)
        timeout: 10000, // Tiempo máximo para completar una transacción (10s)
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
