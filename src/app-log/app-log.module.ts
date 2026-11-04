import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AppLogController } from './app-log.controller';

// Módulo que expone /api/app-log para que la app móvil reporte sus errores.
// Importa AuthModule porque el controller usa JwtAuthGuard.
@Module({
  imports: [AuthModule],
  controllers: [AppLogController],
})
export class AppLogModule {}
