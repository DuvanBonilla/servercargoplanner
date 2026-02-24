import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AuthService } from 'src/auth/auth.service';

@Injectable()
export class SiteInterceptor implements NestInterceptor {
  constructor(private authService: AuthService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const token = request.headers.authorization;

    if (token) {
      const decodedResult = this.authService.decodeToken(token);

      if (decodedResult.valid) {
        const userRole = decodedResult.decoded.role;
        const userSite = decodedResult.decoded.id_site;
        const userSubSite = decodedResult.decoded.id_subsite; // NUEVO
        const userId = decodedResult.decoded.id;

        // SOLO AGREGAR INFORMACIÓN AL REQUEST - NO VALIDAR NADA
        request.userRole = userRole;
        request.userSite = userSite;
        request.userSubSite = userSubSite; // NUEVO
        request.userId = userId;
        request.isSuperAdmin = userRole === 'SUPERADMIN';
        request.userPayload = decodedResult.decoded;

        // NUEVA: Información de seguridad para los decoradores/servicios
        request.securityInfo = {
          role: userRole,
          site: userSite,
          subsite: userSubSite,
          userId: userId,
          
          // Flags de rol
          isSuperAdmin: userRole === 'SUPERADMIN',
          isAdmin: userRole === 'ADMIN',
          isSupervisor: userRole === 'SUPERVISOR',
          isGH: userRole === 'GH',
          
          // Métodos helper para generar filtros (sin aplicar automáticamente)
          getSiteFilter: () => userRole === 'SUPERADMIN' ? {} : { id_site: userSite },
          
          getSubSiteFilter: () => {
            if (userRole === 'SUPERADMIN') return {};
            if (userRole === 'ADMIN') {
              // ADMIN puede ver todas las subsites de su site asignada
              return { id_site: userSite };
            }
            if (userRole === 'SUPERVISOR' && userSubSite) {
              return { id_site: userSite, id_subsite: userSubSite };
            }
            return { id_site: userSite };
          },
          
          // Métodos de verificación (para usar en servicios si necesitas)
          canAccessAllSites: () => userRole === 'SUPERADMIN',
          canAccessSite: (siteId: number) => userRole === 'SUPERADMIN' || userSite === siteId,
          canAccessSubSite: (siteId: number, subsiteId: number) => {
            if (userRole === 'SUPERADMIN') return true;
            if (userRole === 'ADMIN' && userSite === siteId) return true; // ADMIN puede acceder a cualquier subsite de su site
            if (userRole === 'SUPERVISOR' && userSite === siteId && userSubSite === subsiteId) return true;
            return false;
          }
        };
      }
    }

    // EJECUTAR SIN VALIDACIONES - Solo pasar la data tal como viene
    return next.handle().pipe(
      map((data) => data) // No filtrar nada, devolver data original
    );
  }
}