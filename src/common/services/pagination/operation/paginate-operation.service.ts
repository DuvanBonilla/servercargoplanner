import { Injectable } from '@nestjs/common';
import { StatusOperation } from '@prisma/client';
import { OperationFilterDto } from 'src/operation/dto/fliter-operation.dto';
import { PaginationService } from '../pagination.service';
import { PaginatedResponse } from '../../interface/paginate-operation';

@Injectable()
export class PaginateOperationService {
  constructor(private readonly paginationService: PaginationService) {}

  /**
   * Pagina operaciones con sus estadísticas específicas
   */
  async paginateOperations<T>(
    options: {
      prisma: any;
      page?: number;
      limit?: number;
      filters?: OperationFilterDto;
      activatePaginated?: boolean;
      defaultInclude: any;
      transformer: any;
    }
  ): Promise<PaginatedResponse<T>> {
    try {
      const {
        prisma,
        page = 1,
        limit = 10,
        filters,
        activatePaginated = true,
        defaultInclude,
        transformer
      } = options;


      return await this.paginationService.paginateEntity<T, OperationFilterDto>({
        prisma,
        entity: 'operation',
        page,
        limit,
        filters,
        include: defaultInclude,
        orderBy: [{ status: 'asc' }, { dateStart: 'desc' }],
        activatePaginated,
        transformFn: (item) => transformer.transformOperationResponse(item),
        buildWhereClause: (filters) => this.buildOperationWhereClause(filters),
        getAdditionalStats: async () => this.getOperationStats(prisma)
      });
    } catch (error) {
      console.error('Error in paginateOperations:', error);
      throw new Error(`Error paginating operations: ${error.message}`);
    }
  }

  /**
   * Construye la cláusula where para operaciones
   */
  private buildOperationWhereClause(filters?: OperationFilterDto): any {
    const whereClause: any = {};
    
    if (!filters) return whereClause;

    if(filters.id_site){
      whereClause.id_site = filters.id_site;
    }

    if(filters.id_subsite){
      whereClause.id_subsite = filters.id_subsite;
    }

    if (filters.status && filters.status.length > 0) {
      whereClause.status = { in: filters.status };
    }

    if (filters.dateStart) {
      whereClause.dateStart = { gte: filters.dateStart };
    }

    if (filters.dateEnd) {
      whereClause.dateEnd = { lte: filters.dateEnd };
    }

    if (filters.jobAreaId) {
      whereClause.jobArea = { id: filters.jobAreaId };
    }

    if (filters.userId) {
      whereClause.id_user = filters.userId;
    }

    if (filters.inChargedId) {
      whereClause.inChargeOperation = {
        some: {
          id_user: Array.isArray(filters.inChargedId)
            ? { in: filters.inChargedId }
            : filters.inChargedId,
        },
      };
    }

    if (filters.search) {
      // Verificar si el search es un número (posible ID de operación)
    const searchAsNumber = parseInt(filters.search);
    const isNumericSearch = !isNaN(searchAsNumber);

    whereClause.OR = [
      { client: { name: { contains: filters.search, mode: 'insensitive' } } },
      { jobArea: { name: { contains: filters.search, mode: 'insensitive' } } },
      // BUSCAR POR SUBTASK Y CÓDIGO DE SUBTASK EN LOS TRABAJADORES
      { 
        workers: {
          some: {
            SubTask: {
              OR: [
                { name: { contains: filters.search, mode: 'insensitive' } },
                { code: { contains: filters.search, mode: 'insensitive' } },
              ],
            },
          },
        },
      },
    ];
    //  AGREGAR BÚSQUEDA POR ID DE OPERACIÓN SI ES UN NÚMERO
    if (isNumericSearch) {
      whereClause.OR.push({ id: searchAsNumber });
    }
  }

    return whereClause;
  }

  /**
   * Obtiene estadísticas de operaciones por estado
   */
  private async getOperationStats(prisma: any) {
    try {
      const colombiaTime = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }),
      );

      const whereClauseDate = {
        dateStart: colombiaTime,
      };

      const [totalInProgress, totalPending, totalCompleted, totalCanceled] =
        await Promise.all([
          prisma.operation.count({
            where: {
              ...whereClauseDate,
              status: StatusOperation.INPROGRESS,
            },
          }),
          prisma.operation.count({
            where: {
              ...whereClauseDate,
              status: StatusOperation.PENDING,
            },
          }),
          prisma.operation.count({
            where: {
              ...whereClauseDate,
              status: StatusOperation.COMPLETED,
            },
          }),
          prisma.operation.count({
            where: {
              ...whereClauseDate,
              status: StatusOperation.CANCELED,
            },
          }),
        ]);

      return {
        totalInProgress,
        totalPending,
        totalCompleted,
        totalCanceled,
      };
    } catch (error) {
      console.error('Error getting operation stats:', error);
      return {
        totalInProgress: 0,
        totalPending: 0,
        totalCompleted: 0,
        totalCanceled: 0,
      };
    }
  }
}