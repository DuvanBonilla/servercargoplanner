import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private static instance: PrismaService;

  constructor() {
    // ✅ Asegurar que se use la URL del .env sin modificaciones
    super({
      log: ['error', 'warn'], // Reducir logs para debugging
      // Optimizaciones de conexión pool
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
      // Configuración de pool de conexiones
      // connection_limit=5 para limitar conexiones simultáneas
    });
    
    // ✅ Patrón singleton para evitar múltiples instancias
    if (PrismaService.instance) {
      return PrismaService.instance;
    }
    PrismaService.instance = this;
  }

  async onModuleInit() {
    console.log('🔌 Connecting to database...');
    await this.$connect();
    console.log('✅ Database connected successfully');
  }

  async onModuleDestroy() {
    console.log('🔌 Disconnecting from database...');
    await this.$disconnect();
    console.log('✅ Database disconnected');
  }
}