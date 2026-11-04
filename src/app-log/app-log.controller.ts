import {
  Body,
  Controller,
  HttpCode,
  Logger,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { CreateAppLogDto } from './dto/create-app-log.dto';

// Recibe los eventos que registra la app móvil (errores, timeouts, envíos fallidos)
// y los escribe en los logs del servidor con el prefijo [APP], junto al usuario.
// No se guardan en base de datos: quedan en los Runtime Logs de DigitalOcean.
@Controller('app-log')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class AppLogController {
  private readonly logger = new Logger('APP');

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Registrar eventos enviados por la app móvil' })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  create(
    @Body() dto: CreateAppLogDto,
    @CurrentUser('userId') userId: number,
    @CurrentUser('username') username: string,
  ) {
    for (const e of dto.entries) {
      const line = JSON.stringify({
        user: `id=${userId} username=${username}`,
        level: e.level,
        event: e.event,
        message: e.message,
        cid: e.correlationId,
        deviceTime: e.deviceTime,
        appVersion: e.appVersion,
        device: e.device,
        data: e.data,
      });

      if (e.level === 'error') {
        this.logger.error(`[APP] ${line}`);
      } else if (e.level === 'warn') {
        this.logger.warn(`[APP] ${line}`);
      } else {
        this.logger.log(`[APP] ${line}`);
      }
    }

    return { received: dto.entries.length };
  }
}
