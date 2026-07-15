import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { AuthService } from '../auth.service'; // AGREGAR IMPORT
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';


@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private authService: AuthService, // AGREGAR DEPENDENCIA
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // Verificar si la ruta está marcada como pública
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Si es pública, permitir acceso sin validar roles
    if (isPublic) {
      return true;
    }

    // Obtener los roles requeridos del decorador @Roles
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);

    // Si no hay roles definidos, permitir acceso
    if (!requiredRoles) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    
    // OBTENER EL ROL DEL TOKEN DIRECTAMENTE
    let userRole = request.userRole; // Primero intentar desde el interceptor
    
    // Si no existe, decodificar el token aquí mismo
    if (!userRole) {
      const token = request.headers.authorization;
      
      if (!token) {
        throw new ForbiddenException('Authorization token not provided');
      }

      const decodedResult = this.authService.decodeToken(token);
      
      if (!decodedResult.valid) {
        throw new ForbiddenException('Invalid authorization token');
      }

      userRole = decodedResult.decoded.role;
      
      // También agregar al request para que esté disponible después
      request.userRole = userRole;
      request.userSite = decodedResult.decoded.id_site;
      request.userSubSite = decodedResult.decoded.id_subsite;
      request.userId = decodedResult.decoded.id;
      request.isSuperAdmin = userRole === 'SUPERADMIN';
      request.userPayload = decodedResult.decoded;
    }

    if (!userRole) {
      throw new ForbiddenException('User role not found in token');
    }

    // Verificar si el usuario tiene alguno de los roles requeridos
    const hasRole = requiredRoles.includes(userRole);

    if (!hasRole) {
      throw new ForbiddenException(
        `Access denied. Required roles: ${requiredRoles.join(', ')}. Your role: ${userRole}`
      );
    }

    return true;
  }
}