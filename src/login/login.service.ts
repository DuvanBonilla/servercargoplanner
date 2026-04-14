import { HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { CreateLoginDto } from './dto/create-login.dto';
import { AuthService } from 'src/auth/auth.service';
/**
 * Servicio para gestionar acesso a la aplicación
 * @class LoginService
 */
@Injectable()
export class LoginService {
  constructor(private authService: AuthService) {}
  /**
   * validar usuario
   * @param createLoginDto datos del usuario a validar
   * @returns resultado de la operación
   */
  async login(createLoginDto: CreateLoginDto) {
    try {
      const user = await this.authService.validateUser(
        createLoginDto.username,
        createLoginDto.password,
      );

      if (!user) {
        return 'Invalid credentials';
      }
      const token = this.authService.generateToken(user);
      return token;
    } catch (error) {
      throw new Error(error);
    }
  }
  /**
   * salir de la aplicación
   * @param token token de acceso
   * @returns resultado de la operación
   */
  async logout(token: string) {
    try {
      await this.authService.invalidateToken(token);
      return 'Logout successful';
    } catch (error) {
      throw new Error(error);
    }
  }

  async validationToken(token: string) {
    try {
      const user = await this.authService.getTokenExpirationTime(token);
      if (!user) {
        return 'Invalid token';
      }
      return user;
    } catch (error) {
      throw new Error(error);
    }
  }

  /**
   * Refresca el token de acceso con nuevos valores de site/subsite
   * @param token Token actual
   * @param newSiteId Nuevo ID de site (opcional)
   * @param newSubsiteId Nuevo ID de subsite (opcional)
   * @param explicitParams Indica qué parámetros fueron proporcionados explícitamente
   * @returns Nuevo token de acceso
   */
  async refreshToken(
    token: string, 
    newSiteId?: number, 
    newSubsiteId?: number | null,
    explicitParams?: { siteProvided: boolean; subsiteProvided: boolean }
  ) {
    try {
      // Extraer ID de usuario del token
      const userId = this.authService.extractUserIdFromToken(token);
      if (!userId) {
        return {
          message: 'Invalid token',
          statusCode: HttpStatus.UNAUTHORIZED,
        };
      }

      // Verificar que el token no esté en la lista negra
      const isBlacklisted = await this.authService.isTokenBlacklisted(token);
      if (isBlacklisted) {
        return {
          message: 'Token is blacklisted',
          statusCode: HttpStatus.UNAUTHORIZED,
        };
      }

      // Invalidar token actual
      await this.authService.invalidateToken(token);

      // Generar nuevo token con los nuevos valores
      const newToken = await this.authService.refreshUserToken(
        userId,
        newSiteId,
        newSubsiteId,
        explicitParams
      );

      return newToken;
    } catch (error) {
      console.error('Error refreshing token:', error);
      throw new Error(`Error refreshing token: ${(error as Error).message}`);
    }
  }
}
