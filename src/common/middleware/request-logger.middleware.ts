import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { JwtService } from '@nestjs/jwt';

/**
 * Middleware global que registra en logs cada petición HTTP junto con el
 * usuario autenticado que la realizó (id/username/role), método, ruta,
 * status code, tiempo de respuesta e IP.
 *
 * Se aplica a nivel global en AppModule para que quede constancia de qué
 * usuario/endpoint generó cada request, útil para depurar picos de CPU o
 * uso indebido de la API.
 */
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly jwtService: JwtService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const { method, originalUrl } = req;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    const userInfo = this.extractUserInfo(req);

    res.on('finish', () => {
      const durationMs = Date.now() - startTime;
      const { statusCode } = res;
      const message = `${method} ${originalUrl} ${statusCode} ${durationMs}ms - user=${userInfo} ip=${ip}`;

      // Marcar como advertencia las peticiones lentas (>3s) para facilitar
      // encontrar en logs los endpoints que consumen más CPU/tiempo.
      if (durationMs > 3000) {
        this.logger.warn(`[LENTA] ${message}`);
      } else if (statusCode >= 500) {
        this.logger.error(message);
      } else {
        this.logger.log(message);
      }
    });

    next();
  }

  private extractUserInfo(req: Request): string {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return 'anonymous';
      }

      const token = authHeader.replace('Bearer ', '');
      const decoded: any = this.jwtService.decode(token);

      if (!decoded) {
        return 'anonymous';
      }

      return `id=${decoded.id} username=${decoded.username} role=${decoded.role}`;
    } catch {
      return 'anonymous';
    }
  }
}
