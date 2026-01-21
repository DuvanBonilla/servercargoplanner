import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { StatusOperation } from '@prisma/client';
import { OperationFilterDto } from 'src/operation/dto/fliter-operation.dto';
import { PaginationService } from '../pagination.service';
import { PaginatedResponse } from '../../interface/paginate-operation';

@Injectable()
export class PaginateOperationService {
  private readonly STATS_CACHE_TTL = 300; // 5 minutos en segundos
  private readonly LARGE_DATASET_CACHE_TTL = 600; // 10 minutos para datasets grandes
  
  constructor(
    private readonly paginationService: PaginationService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

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
        // Optimizar ordenamiento para grandes datasets
        // Usar ID como campo secundario para consistencia y rendimiento
        orderBy: [{ status: 'asc' }, { id: 'desc' }],
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

    // ✅ FILTROS DE FECHA: Buscar operaciones que INICIARON en el rango
    if (filters.dateStart && filters.dateEnd) {
      const startDate = new Date(filters.dateStart);
      const endDate = new Date(filters.dateEnd);

      // Filtrar solo por operaciones que INICIARON dentro del rango
      whereClause.dateStart = {
        gte: startDate,
        lte: endDate
      };
    } else if (filters.dateStart) {
      whereClause.dateStart = { gte: filters.dateStart };
    } else if (filters.dateEnd) {
      whereClause.dateStart = { lte: filters.dateEnd };
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
      const searchAsNumber = parseInt(filters.search);
      const isNumericSearch = !isNaN(searchAsNumber);

      const searchConditions: any[] = [
        { client: { name: { contains: filters.search, mode: 'insensitive' } } },
        { jobArea: { name: { contains: filters.search, mode: 'insensitive' } } },
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

      if (isNumericSearch) {
        searchConditions.push({ id: searchAsNumber });
      }

      whereClause.OR = searchConditions;
    }

    return whereClause;
  }

  /**
   * Obtiene estadísticas de operaciones por estado (con caché de 5 minutos)
   */
  private async getOperationStats(prisma: any) {
    try {
      // Intentar obtener del caché primero
      const cacheKey = 'operation-stats';
      const cached = await this.cacheManager.get(cacheKey);
      
      if (cached) {
        return cached;
      }

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

      const stats = {
        totalInProgress,
        totalPending,
        totalCompleted,
        totalCanceled,
      };
      
      // Guardar en caché por 5 minutos
      await this.cacheManager.set(cacheKey, stats, this.STATS_CACHE_TTL * 1000);
      
      return stats;
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