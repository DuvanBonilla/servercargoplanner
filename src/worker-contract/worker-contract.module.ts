import { Module } from '@nestjs/common';
import { AuthModule } from 'src/auth/auth.module';
import { WorkerContractService } from './worker-contract.service';
import { WorkerContractController } from './worker-contract.controller';

@Module({
  imports: [AuthModule],
  controllers: [WorkerContractController],
  providers: [WorkerContractService],
  exports: [WorkerContractService],
})
export class WorkerContractModule {}
