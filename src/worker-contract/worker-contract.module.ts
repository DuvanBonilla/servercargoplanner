import { Module } from '@nestjs/common';
import { AuthModule } from 'src/auth/auth.module';
import { WorkerContractService } from './worker-contract.service';

// Lógica de contratos; sus endpoints se exponen en WorkerController (/worker/:id/contracts)
@Module({
  imports: [AuthModule],
  providers: [WorkerContractService],
  exports: [WorkerContractService],
})
export class WorkerContractModule {}
