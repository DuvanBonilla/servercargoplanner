import { Injectable } from '@nestjs/common';
import { PaginatedResponse } from '../../interface/paginate-operation';
import { PaginationService } from '../pagination.service';
import { FilterCalledAttentionDto } from 'src/called-attention/dto/filter-called-attention'; 

/**
 * Servicio específico para la paginación de llamadas de atención
 */
@Injectable()
export class PaginationCalledService {
  constructor(private readonly paginationService: PaginationService) {}

  /**
   * Pagina las llamadas de atención con opciones específicas
   */
  async paginateCalledAttentions<T>(
    options: {
      prisma: any;
      page?: number;
      limit?: number;
      filters?: FilterCalledAttentionDto;
      activatePaginated?: boolean;
    }
  ): Promise<PaginatedResponse<T>> {
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
        filters?.activatePaginated !== undefined ? 
        filters.activatePaginated : 
        activatePaginated;

      // Usar el servicio genérico de paginación
      return await this.paginationService.paginateEntity<T>({
        prisma,
        entity: 'calledAttention',
        page,
        limit,
        filters,
        include: {
          worker: {
            select: {
              dni: true,
              name: true,
              status: true,
              id_site: true,
            },
          },
          user: {
            select: {
              name: true,
            },
          },
        },
        orderBy: {
          createAt: 'desc',
        },
        activatePaginated: finalActivatePaginated,
        buildWhereClause: filters => this.buildCalledAttentionWhereClause(filters),
      });
    } catch (error) {
      console.error('Error paginating called attentions:', error);
      throw new Error(`Error paginating called attentions: ${error.message}`);
    }
  }

  /**
   * Construye la cláusula where para las llamadas de atención
   */
  private buildCalledAttentionWhereClause(filters?: FilterCalledAttentionDto): any {
    const whereClause: any = {};
    
    if (!filters) {
      // console.log('[PaginationCalledService] No hay filtros, retornando whereClause vacío');
      return whereClause;
    }

    // Filtro por tipo de llamado de atención
    if (filters.type) {
      whereClause.type = filters.type;
    }

    // Filtro por fecha de inicio
    if (filters.startDate) {
      whereClause.createAt = { 
        ...whereClause.createAt,
        gte: new Date(filters.startDate) 
      };
    }

    // Filtro por fecha de fin
    if (filters.endDate) {
      whereClause.createAt = { 
        ...whereClause.createAt,
        lte: new Date(filters.endDate) 
      };
    }

    // Manejar filtro de búsqueda combinado con id_site
    if (filters.search && filters.search.trim() !== '') {
      const searchTerm = filters.search.trim();
      
      // Si hay id_site, incluirlo en cada condición del OR
      if (filters.id_site) {
        whereClause.OR = [
          { 
            worker: { 
              id_site: filters.id_site,
              dni: { contains: searchTerm, mode: 'insensitive' } 
            } 
          },
          { 
            worker: { 
              id_site: filters.id_site,
              name: { contains: searchTerm, mode: 'insensitive' } 
            } 
          },
        ];
      } else {
        // Sin id_site, solo buscar por DNI o nombre
        whereClause.OR = [
          { worker: { dni: { contains: searchTerm, mode: 'insensitive' } } },
          { worker: { name: { contains: searchTerm, mode: 'insensitive' } } }
        ];
      }
    } else if (filters.id_site) {
      // Solo filtro por id_site sin búsqueda
      whereClause.worker = { id_site: filters.id_site };
    }

    // console.log('[PaginationCalledService] whereClause construido:', JSON.stringify(whereClause, null, 2));
    return whereClause;
  }
}