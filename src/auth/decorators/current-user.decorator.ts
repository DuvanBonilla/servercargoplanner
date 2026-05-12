import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '@prisma/client';

export const CurrentUser = createParamDecorator(
  (data: string, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();

    // Si no se especifica un campo, retornar request.user completo (funcionalidad original)
    if (!data) {
      return request.user || request.userPayload || null;
    }

    // Para campos específicos, buscar en múltiples fuentes
    let result;
    switch (data) {
      case 'userId':
        // Primero buscar en request.user, luego en SiteInterceptor
        result =
          request.user?.userId || request.userId || request.userPayload?.id;
        break;
      case 'siteId':
        // Buscar en SiteInterceptor primero para este campo
        result =
          request.userSite ||
          request.user?.siteId ||
          request.userPayload?.id_site;
        break;
      case 'isSuperAdmin':
        // Buscar en SiteInterceptor primero
        result =
          request.isSuperAdmin !== undefined
            ? request.isSuperAdmin
            : request.user?.role === 'SUPERADMIN' ||
              request.userPayload?.role === 'SUPERADMIN';
        break;
      case 'role':
        result =
          request.userRole || request.user?.role || request.userPayload?.role;
        break;
      case 'siteName':
        result = request.userPayload?.site || request.user?.siteName;
        break;
      case 'username':
        result = request.user?.username || request.userPayload?.username;
        break;
      case 'name':
        result = request.user?.name || request.userPayload?.name;
        break;
      case 'dni':
        result = request.user?.dni || request.userPayload?.dni;
        break;
      case 'occupation':
        result = request.user?.occupation || request.userPayload?.occupation;
        break;
      case 'phone':
        result = request.user?.phone || request.userPayload?.phone;
        break;
      case 'status':
        result = request.user?.status || request.userPayload?.status;
        break;
      case 'isSupervisor':
        result =
          request.isSupervisor !== undefined
            ? request.isSupervisor
            : request.user?.role === Role.SUPERVISOR ||
              request.userPayload?.role === Role.SUPERVISOR;
        break;
      case 'isProgrammer':
        result =
          request.isProgrammer !== undefined
            ? request.isProgrammer
            : request.user?.role === Role.PROGRAMMER ||
              request.userPayload?.role === Role.PROGRAMMER;
        break;
      case 'subsiteId':
        result =
          request.userPayload?.id_subsite ||
          request.user?.subsiteId ||
          request.user?.id_subsite;
        break;
      case 'isAdmin':
        result =
          request.isAdmin !== undefined
            ? request.isAdmin
            : request.user?.role === Role.ADMIN ||
              request.userPayload?.role === Role.ADMIN;
        break;
      case 'isGH':
        result =
          request.isGH !== undefined
            ? request.isGH
            : request.user?.role === Role.GH ||
              request.userPayload?.role === Role.GH;
        break;  
      default:
        // Para otros campos, buscar en request.user primero, luego en userPayload
        result = request.user?.[data] || request.userPayload?.[data];
        break;
    }

    return result;
  },
);
