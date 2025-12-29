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
    try {
      await this.$connect();
      console.log('✅ Database connected successfully');
    } catch (error) {
      console.error('❌ Database connection FAILED:');
      console.error(`   Error: ${error.message}`);
      if (error.message?.includes('timeout')) {
        console.error('   ⚠️ Connection timeout - Check DATABASE_URL and PostgreSQL server status');
      } else if (error.message?.includes('authentication failed')) {
        console.error('   ⚠️ Authentication failed - Check username/password in DATABASE_URL');
      } else if (error.message?.includes('too many clients')) {
        console.error('   ⚠️ Too many connections - Reduce connection_limit in DATABASE_URL');
      }
      throw error; // Re-throw para que NestJS maneje el error
    }
  }

  async onModuleDestroy() {
    console.log('🔌 Disconnecting from database...');
    await this.$disconnect();
    console.log('✅ Database disconnected');
  }
}