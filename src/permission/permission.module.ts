import { Module } from '@nestjs/common';
import { PermissionService } from './permission.service';
import { PermissionController } from './permission.controller';
import { AuthModule } from 'src/auth/auth.module';
import { ValidationService } from 'src/common/validation/validation.service';
import { ExcelExportService } from 'src/common/validation/services/excel-export.service';
import { UpdatePermissionService } from './services/update-permission.service';

@Module({
  imports: [AuthModule],
  controllers: [PermissionController],
  providers: [PermissionService, ValidationService, ExcelExportService, UpdatePermissionService],
  
})
export class PermissionModule {}

