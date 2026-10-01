import { Module } from '@nestjs/common';
import { AreaService } from './area.service';
import { AreaController } from './area.controller';
import { UserService } from '../user/user.service';
import { AuthModule } from '../auth/auth.module';
import { ValidationModule } from 'src/common/validation/validation.module';

@Module({
  imports: [AuthModule, ValidationModule],
  controllers: [AreaController],
  providers: [AreaService],
})
export class AreaModule {}
