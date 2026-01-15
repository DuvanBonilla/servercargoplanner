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
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
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
}
bootstrap();