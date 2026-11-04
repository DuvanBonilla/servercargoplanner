import { Module } from '@nestjs/common';
import { AuthModule } from 'src/auth/auth.module';
import { MinimumWageService } from './minimum-wage.service';
import { MinimumWageController } from './minimum-wage.controller';

@Module({
  imports: [AuthModule],
  controllers: [MinimumWageController],
  providers: [MinimumWageService],
  exports: [MinimumWageService],
})
export class MinimumWageModule {}
