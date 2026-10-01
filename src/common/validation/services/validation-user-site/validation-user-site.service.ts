import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class ValidationUserSiteService {
  constructor(private readonly prisma: PrismaService) {}
  /**
   * Valida si un usuario tiene acceso a un site específico
   * @param userId ID del usuario
   * @param siteId ID del site
   * @returns true si el usuario tiene acceso, false en caso contrario
   */
  async validateUserSite(userId: number, siteId: number): Promise<boolean> {
    try {
      // Para superadmin, siempre permitir acceso a cualquier site
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });

      if (user?.role === 'SUPERADMIN') {
        // Verificar que el site existe
        const siteExists = await this.prisma.site.findUnique({
          where: { id: siteId, status: 'ACTIVE' },
        });
        return !!siteExists;
      }

      // Para otros roles, verificar que tienen asignado ese site
      const userSite = await this.prisma.user.findFirst({
        where: {
          id: userId,
          id_site: siteId,
        },
      });

      return !!userSite;
    } catch (error) {
      console.error('Error validating user site:', error);
      return false;
    }
  }

  /**
   * Valida si un usuario tiene acceso a un subsite específico
   * @param userId ID del usuario
   * @param siteId ID del site
   * @param subsiteId ID del subsite
   * @returns true si el usuario tiene acceso, false en caso contrario
   */
  async validateUserSubsite(
    userId: number,
    siteId: number,
    subsiteId: number,
  ): Promise<boolean> {
    try {
      // Verificar que el subsite existe y pertenece al site
      const subsite = await this.prisma.subSite.findFirst({
        where: {
          id: subsiteId,
          id_site: siteId,
          status: 'ACTIVE',
        },
      });

      if (!subsite) {
        return false;
      }

      // Para superadmin, permitir acceso a cualquier subsite
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });

      if (user?.role === 'SUPERADMIN') {
        return true;
      }

      // Para supervisores ó programadores, verificar que la subsede esté entre las asignadas
      if (user?.role === 'SUPERVISOR' || user?.role === 'PROGRAMMER' || user?.role === 'RECEPTION') {
        const membership = await this.prisma.userSubSite.findUnique({
          where: { id_user_id_subsite: { id_user: userId, id_subsite: subsiteId } },
        });
        return !!membership;
      }

      // Para otros roles, solo verificar que tienen asignado el site correcto
      return await this.validateUserSite(userId, siteId);
    } catch (error) {
      console.error('Error validating user subsite:', error);
      return false;
    }
  }

  /**
   * Obtiene información de un site por su ID
   * @param siteId ID del site
   * @returns Información del site
   */
  async getSiteById(siteId: number) {
    return this.prisma.site.findUnique({
      where: { id: siteId },
    });
  }

  /**
   * Todas las subsedes asignadas a un usuario
   */
  async getAssignedSubsiteIds(userId: number): Promise<number[]> {
    const rows = await this.prisma.userSubSite.findMany({
      where: { id_user: userId },
      select: { id_subsite: true },
    });
    return rows.map((r) => r.id_subsite);
  }

  /**
   * Todas las áreas asignadas a un usuario. Lista vacía = sin restricción.
   */
  async getAssignedAreaIds(userId: number): Promise<number[]> {
    const rows = await this.prisma.userJobArea.findMany({
      where: { id_user: userId },
      select: { id_area: true },
    });
    return rows.map((r) => r.id_area);
  }

  /**
   * Un usuario sin áreas asignadas no tiene restricción de área.
   */
  async isAreaAllowedForUser(userId: number, areaId: number): Promise<boolean> {
    const assigned = await this.getAssignedAreaIds(userId);
    return assigned.length === 0 || assigned.includes(areaId);
  }
}
