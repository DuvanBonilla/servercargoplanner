import { Module } from '@nestjs/common';
import { AuthModule } from 'src/auth/auth.module';
import { ArlService } from './arl.service';
import { ArlController } from './arl.controller';

@Module({
  imports: [AuthModule],
  controllers: [ArlController],
  providers: [ArlService],
  exports: [ArlService],
})
export class ArlModule {}
