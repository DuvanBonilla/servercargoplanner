import { forwardRef, Module } from '@nestjs/common';
import { OperationService } from './operation.service';
import { OperationController } from './operation.controller';
import { ValidationModule } from 'src/common/validation/validation.module';
import { OperationWorkerService } from 'src/operation-worker/operation-worker.service';
import { OperationInChargeService } from 'src/in-charged/in-charged.service';
import { OperationFinderService } from './services/operation-finder.service';
import { OperationTransformerService } from './services/operation-transformer.service';
import { OperationRelationService } from './services/operation-relation.service';
import { WorkerAnalyticsService } from 'src/operation/services/workerAnalytics.service';
import { PaginationModule } from 'src/common/services/pagination/pagination.module';
import { AuthModule } from 'src/auth/auth.module';
import { OperationWorkerModule } from 'src/operation-worker/operation-worker.module';
import { TariffModule } from 'src/tariff/tariff.module';
import { WorkerModule } from 'src/worker/worker.module';
import { BillModule } from 'src/bill/bill.module';
import { OperationExportService } from './services/operation-export.service';

@Module({
  imports: [
    ValidationModule,
    PaginationModule,
    AuthModule,
    OperationWorkerModule,
    TariffModule,
    forwardRef(() => WorkerModule),
    forwardRef(() => BillModule),
  ],
  controllers: [OperationController],
  providers: [
    OperationService,
    OperationWorkerService,
    OperationInChargeService,
    OperationFinderService,
    OperationTransformerService,
    OperationRelationService,
    WorkerAnalyticsService,
    OperationExportService,
  ],
  exports: [OperationFinderService]
})
export class OperationModule {}
