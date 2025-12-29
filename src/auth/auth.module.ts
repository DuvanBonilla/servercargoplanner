import { Module } from '@nestjs/common';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UserService } from 'src/user/user.service';
import { ConfigService } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { RolesGuard } from './guards/roles.guard';
import { ValidationModule } from 'src/common/validation/validation.module';



@Module({

  imports: [

    ValidationModule,
    PassportModule,
    CacheModule.register({
      ttl: 60 * 60 * 24, // 24 horas
      max: 1000, // Aumentado de 100 a 1000 items
    }),

    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService): JwtModuleOptions => {
        return {
          secret: configService.get<string>('SECRET_JWT') || 'default-secret-key',
          signOptions: { 
            expiresIn: configService.get('EXPIRES_IN') || '24h'
          },

        };

      },

    }),

  ],

  providers: [
    AuthService,
    JwtStrategy,
    UserService,
    RolesGuard,
  ],

  exports: [AuthService, JwtModule, RolesGuard],

})

export class AuthModule {}