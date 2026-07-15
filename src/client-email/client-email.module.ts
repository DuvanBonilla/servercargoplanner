import { Module } from '@nestjs/common';
import { ClientEmailService } from './client-email.service';
import { ClientEmailController } from './client-email.controller';
import { AuthModule } from 'src/auth/auth.module';

@Module({
    imports: [AuthModule],
  controllers: [ClientEmailController],
  providers: [ClientEmailService],
})
export class ClientEmailModule {}
