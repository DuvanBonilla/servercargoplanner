import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as cookieParser from 'cookie-parser';
import { AuthService } from './auth/auth.service';
import { DocsAuthMiddleware } from './common/middleware/docs-auth.middleware';

async function bootstrap() {
  try {
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
      logger: ['error', 'warn'], // Solo muestra errores y advertencias, oculta logs de inicialización
    });
    app.set('trust proxy', 'loopback');
    app.use(cookieParser());
    
    const authService = app.get(AuthService);

    const docsAuthMiddleware = new DocsAuthMiddleware(authService);
    app.use('/docs', docsAuthMiddleware.use.bind(docsAuthMiddleware));
    
    app.enableCors({
      origin: '*',
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
      preflightContinue: false,
      optionsSuccessStatus: 204,
      credentials: true,
    });
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    );

    const config = new DocumentBuilder()
      .setTitle('Planner API')
      .setDescription('API app planner operations')
      .setVersion('1.0')
      .addTag('Planner operations')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'JWT',
          description: 'Ingresa tu token JWT',
          in: 'header',
        },
        'access-token',)
      .build();
    const documentFactory = () => SwaggerModule.createDocument(app, config);
      SwaggerModule.setup('api', app, documentFactory, {
      swaggerOptions: {
        persistAuthorization: true, // Permite que la autorización persista entre recargas
      },
    });


    const docsPath = join(process.cwd(), 'docs');
    app.useStaticAssets(docsPath, {
      prefix: '/docs/',
    });
    
    // Configuración para archivos públicos (como login.html)
    const publicPath = join(process.cwd(), 'public');
    app.useStaticAssets(publicPath);

    app.enableShutdownHooks();

    await app.listen(process.env.PORT ?? 3001, '0.0.0.0');
    
    console.log(`✅ Servidor iniciado correctamente `);
    console.log(`📡 Todos los endpoints cargados y disponibles`);
  } catch (error) {
    console.error('❌ Error al iniciar el servidor:');
    
    // Identificar el tipo de error
    if (error.message?.includes('Cannot find module')) {
      const moduleName = error.message.match(/'([^']+)'/)?.[1];
      console.error(`   ⚠️ Módulo no encontrado: ${moduleName}`);
    } else if (error.message?.includes('Nest can\'t resolve dependencies')) {
      console.error('   ⚠️ Error de dependencias en módulos');
      console.error(`   📋 Detalles: ${error.message}`);
    } else if (error.message?.includes('Controller') || error.message?.includes('Provider')) {
      console.error('   ⚠️ Error al cargar controlador o proveedor');
      console.error(`   📋 Detalles: ${error.message}`);
    } else {
      console.error(`   📋 ${error.message}`);
    }
    
    console.error('\n🔍 Stack trace completo:');
    console.error(error.stack);
    throw error;
  }
  
  // Monitorear uso de memoria cada 5 minutos
  setInterval(() => {
    const usage = process.memoryUsage();
    const usedMB = Math.round(usage.heapUsed / 1024 / 1024);
    const totalMB = Math.round(usage.heapTotal / 1024 / 1024);
    const externalMB = Math.round(usage.external / 1024 / 1024);
    
    console.log(`📊 Memory: ${usedMB}MB / ${totalMB}MB (External: ${externalMB}MB)`);
    
    // Advertir si el uso de memoria es alto (>400MB)
    if (usedMB > 400) {
      console.warn(`⚠️ High memory usage: ${usedMB}MB`);
    }
  }, 5 * 60 * 1000); // Cada 5 minutos
}

bootstrap().catch((error) => {
  console.error('\n❌❌❌ FALLO CRÍTICO AL INICIAR EL SERVIDOR ❌❌❌\n');
  console.error('El servidor no pudo iniciarse debido a los siguientes errores:\n');
  process.exit(1);
});

// Capturar errores no controlados para evitar que el servidor se caiga
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
  // No cerrar el servidor, solo loggear el error
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  // Solo cerrar si es un error crítico del sistema
  if (error.message?.includes('EADDRINUSE') || error.message?.includes('EACCES')) {
    process.exit(1);
  }
});