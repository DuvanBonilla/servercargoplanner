import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ValidationService } from '../common/validation/validation.service';
import { AssignInChargeDto } from './dto/assign-in-charge.dto';
import { RemoveInChargeDto } from './dto/remove-in-charge.dto';

@Injectable()
export class OperationInChargeService {
  constructor(
    private prisma: PrismaService,
    private validationService: ValidationService,
  ) {}

  /**
   * Asigna usuarios encargados a una operación
   * @param assignDto - Datos de asignación
   * @returns Resultado de la operación
   */
  async assignInChargeToOperation(assignDto: AssignInChargeDto) {
    try {
      const { id_operation, userIds } = assignDto;

      // Verificar que la operación existe
      const operation = await this.prisma.operation.findUnique({
        where: { id: id_operation },
      });

      if (!operation) {
        return { message: 'Operation not found', status: 404 };
      }

      // Validar que todos los usuarios existen
      if (userIds && userIds.length > 0) {
        const userValidation = await this.validationService.validateAllIds({
          inChargedIds: userIds,
        });

        if (userValidation && 'status' in userValidation && userValidation.status === 404) {
          return userValidation;
        }

        // Obtener encargados que ya están asignados a esta operación
        const currentInCharge = await this.prisma.inChargeOperation.findMany({
          where: { id_operation },
          select: { id_user: true },
        });

        const currentUserIds = currentInCharge.map(charge => charge.id_user);

        // Filtrar para solo añadir encargados que no están ya asignados
        const usersToAdd = userIds.filter(
          userId => !currentUserIds.includes(userId),
        );

        if (usersToAdd.length > 0) {
          // Crear nuevas relaciones
          await this.prisma.inChargeOperation.createMany({
            data: usersToAdd.map(userId => ({
              id_operation,
              id_user: userId,
            })),
            skipDuplicates: true, // Evitar duplicados
          });

          return { 
            message: `${usersToAdd.length} users assigned as in charge of operation ${id_operation}`,
            assignedUsers: usersToAdd
          };
        }

        return { message: 'No new users to assign', assignedUsers: [] };
      }

      return { message: 'No users to assign', assignedUsers: [] };
    } catch (error) {
      console.error('Error assigning in charge users to operation:', error);
      throw new Error((error as Error).message);
    }
  }

  /**
   * Remueve usuarios encargados de una operación
   * @param removeDto - Datos de remoción
   * @returns Resultado de la operación
   */
  async removeInChargeFromOperation(removeDto: RemoveInChargeDto) {
    try {
      const { id_operation, userIds } = removeDto;

      // Verificar que la operación existe
      const operation = await this.prisma.operation.findUnique({
        where: { id: id_operation },
      });

      if (!operation) {
        return { message: 'Operation not found', status: 404 };
      }

      // Validar que todos los usuarios existen
      if (userIds && userIds.length > 0) {
        const userValidation = await this.validationService.validateAllIds({
          inChargedIds: userIds,
        });

        if (userValidation && 'status' in userValidation && userValidation.status === 404) {
          return userValidation;
        }

        // Eliminar solo las relaciones especificadas
        await this.prisma.inChargeOperation.deleteMany({
          where: {
            id_operation,
            id_user: { in: userIds },
          },
        });

        return { 
          message: `${userIds.length} users removed from in charge of operation ${id_operation}`,
          removedUsers: userIds
        };
      }

      return { message: 'No users to remove', removedUsers: [] };
    } catch (error) {
      console.error('Error removing in charge users from operation:', error);
      throw new Error((error as Error).message);
    }
  }

  /**
   * Obtiene todos los usuarios encargados de una operación
   * @param id_operation - ID de la operación
   * @returns Lista de usuarios encargados
   */
  async getInChargeUsersFromOperation(id_operation: number) {
    try {
      // Verificar que la operación existe
      const operation = await this.prisma.operation.findUnique({
        where: { id: id_operation },
      });

      if (!operation) {
        return { message: 'Operation not found', status: 404 };
      }

      // Obtener los encargados con sus detalles
      const inChargeUsers = await this.prisma.inChargeOperation.findMany({
        where: { id_operation },
        select: {
          user: {
            select: {
              id: true,
              name: true,
              username: true,
              role: true,
              occupation: true,
            }
          }
        }
      });

      const users = inChargeUsers.map(ic => ic.user);

      return users;
    } catch (error) {
      console.error('Error getting in charge users from operation:', error);
      throw new Error((error as Error).message);
    }
  }
}