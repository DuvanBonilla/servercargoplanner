import { Module } from '@nestjs/common';
import { ZoneService } from './zone.service';
import { ZoneExportService } from './zone-export.service';
import { ZoneController } from './zone.controller';
import { AuthModule } from '../auth/auth.module';

// Módulo Nest que agrupa el CRUD de Zona y su exportación a Excel.
// Importa AuthModule porque el controller usa JwtAuthGuard/RolesGuard.
@Module({
  imports: [AuthModule],
  controllers: [ZoneController],
  providers: [ZoneService, ZoneExportService],
})
export class ZoneModule {}
