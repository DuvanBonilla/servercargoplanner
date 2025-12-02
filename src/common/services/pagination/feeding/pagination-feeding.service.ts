import { Injectable } from '@nestjs/common';
import { PaginatedResponse } from '../../interface/paginate-operation';
import { PaginationService } from '../pagination.service';
import { FilterWorkerFeedingDto } from 'src/feeding/dto/filter-worker-feeding.dto';

/**
 * Servicio específico para la paginación de alimentación de trabajadores
 */
@Injectable()
export class PaginationFeedingService {
  constructor(private readonly paginationService: PaginationService) {}

  /**
   * Pagina los registros de alimentación con opciones específicas
   */
  async paginateWorkerFeeding<T>(options: {
    prisma: any;
    page?: number;
    limit?: number;
    filters?: FilterWorkerFeedingDto;
    activatePaginated?: boolean;
  }): Promise<PaginatedResponse<T>> {
    try {
      const {
        prisma,
        page = 1,
        limit = 10,
        filters,
        activatePaginated = true,
      } = options;

      // Extraer activatePaginated del filtro si está definido
      const finalActivatePaginated =
        filters?.activatePaginated !== undefined
          ? filters.activatePaginated
          : activatePaginated;

      // Usar el servicio genérico de paginación
      return await this.paginationService.paginateEntity<T>({
        prisma,
        entity: 'workerFeeding',
        page,
        limit,
        filters,
        include: {
          worker: {
            select: {
              dni: true,
              name: true,
              status: true,
            },
          },
          operation: {
            select: {
              id: true,
              status: true,
              dateStart: true,
              motorShip: true,
              client: {
                select: {
                  name: true,
                },
              },
              task: {
                select: {
                  name: true,
                },
              },
              
            },
          },
          user: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          dateFeeding: 'desc',
        },
        activatePaginated: finalActivatePaginated,
        buildWhereClause: (filters) =>
          this.buildWorkerFeedingWhereClause(filters),
      });
    } catch (error) {
      console.error('Error paginating worker feeding:', error);
      throw new Error(`Error paginating worker feeding: ${error.message}`);
    }
  }

  /**
   * Construye la cláusula where para la alimentación de trabajadores
   */
  private buildWorkerFeedingWhereClause(filters?: FilterWorkerFeedingDto): any {
    const whereClause: any = {};

    if (!filters) return whereClause;

    if (filters.id_site) {
      whereClause.worker = { id_site: filters.id_site };
    }

    // Filtro por tipo de alimentación
    if (filters.type) {
      whereClause.type = filters.type;
    }

    // Filtro por fecha de inicio
    if (filters.startDate) {
      whereClause.dateFeeding = {
        ...whereClause.dateFeeding,
        gte: new Date(filters.startDate),
      };
    }

    // Filtro por fecha de fin
    if (filters.endDate) {
      whereClause.dateFeeding = {
        ...whereClause.dateFeeding,
        lte: new Date(filters.endDate),
      };
    }

    // Filtro de búsqueda por DNI o nombre del trabajador
    if (filters.search && filters.search.trim() !== '') {
      const searchTerm = filters.search.trim();

      // Buscar tanto en DNI como en nombre del trabajador
      whereClause.OR = [
        { worker: { dni: { contains: searchTerm, mode: 'insensitive' } } },
        { worker: { name: { contains: searchTerm, mode: 'insensitive' } } },
      ];
    }

    return whereClause;
  }
}
