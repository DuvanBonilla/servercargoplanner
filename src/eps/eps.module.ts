import { Module } from '@nestjs/common';
import { AuthModule } from 'src/auth/auth.module';
import { EpsService } from './eps.service';
import { EpsController } from './eps.controller';

@Module({
  imports: [AuthModule],
  controllers: [EpsController],
  providers: [EpsService],
  exports: [EpsService],
})
export class EpsModule {}
