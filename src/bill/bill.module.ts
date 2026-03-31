import { forwardRef, Module } from '@nestjs/common';
import { BillService } from './bill.service';
import { BillController } from './bill.controller';

import { AuthModule } from 'src/auth/auth.module';
import { OperationModule } from 'src/operation/operation.module';
import { WorkerGroupAnalysisService } from './services/worker-group-analysis.service';
import { PayrollCalculationService } from './services/payroll-calculation.service';
import { ConfigurationModule } from 'src/configuration/configuration.module';
import { HoursCalculationService } from './services/hours-calculation.service';
import { BaseCalculationService } from './services/base-calculation.service';

@Module({
  imports: [AuthModule, forwardRef(() => OperationModule), ConfigurationModule],
  controllers: [BillController],
  providers: [
    BillService,
    WorkerGroupAnalysisService,
    PayrollCalculationService,
    HoursCalculationService,
    BaseCalculationService
  ],
  exports:[BillService],
})
export class BillModule {}
