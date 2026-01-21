import { Injectable } from '@nestjs/common';
import { PageData, PaginatedResponse } from '../interface/paginate-operation';

@Injectable()
export class PaginationService {
  /**
   * Procesa los resultados de una consulta y los organiza en formato paginado con prefetch
   * @param items Elementos a paginar
   * @param page Número de página actual
   * @param limit Límite de elementos por página
   * @param totalItems Total de elementos en la base de datos
   * @returns Resultados paginados con prefetch de páginas adicionales
   */
  processPaginatedResults<T>(
    items: T[],
    page: number,
    limit: number,
    totalItems: number,
    additionalStats?: Record<string, any>
  ): PaginatedResponse<T> {
    const pageNumber = Math.max(1, page);
    const itemsPerPage = Math.min(100, Math.max(1, limit));
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    
    // Si no hay elementos
    if (items.length === 0) {
      return {
        pagination: {
          totalItems: 0,
          itemsPerPage,
          currentPage: pageNumber,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
          ...additionalStats
        },
        items: [],
        nextPages: [],
      };
    }
    
    // Separar los elementos entre la página actual y las siguientes
    const currentPageItems = items.slice(0, itemsPerPage);
    
    // Organizar las páginas adicionales
    const nextPagesItems: PageData<T>[] = [];
    
    for (let i = 0; i < Math.min(2, totalPages - pageNumber); i++) {
      const startIndex = (i + 1) * itemsPerPage;
      const endIndex = startIndex + itemsPerPage;
      const pageItems = items.slice(startIndex, endIndex);
      
      if (pageItems.length > 0) {
        nextPagesItems.push({
          pageNumber: pageNumber + i + 1,
          items: pageItems,
        });
      }
    }
    
    return {
      pagination: {
        totalItems,
        itemsPerPage,
        currentPage: pageNumber,
        totalPages,
        hasNextPage: pageNumber < totalPages,
        hasPreviousPage: pageNumber > 1,
        ...additionalStats
      },
      items: currentPageItems,
      nextPages: nextPagesItems,
    };
  }
  
  /**
   * Método genérico para paginar cualquier entidad
   * @param options Opciones para la paginación
   * @returns Resultados paginados
   */
  async paginateEntity<T, F = any>(
    options: {
      prisma: any;
      entity: string;
      page?: number;
      limit?: number;
      where?: any;
      filters?: F;
      include?: any;
      orderBy?: any;
      activatePaginated?: boolean;
      transformFn?: (item: any) => T;
      buildWhereClause?: (filters: F) => any;
      getAdditionalStats?: () => Promise<Record<string, any>>;
    }
  ): Promise<PaginatedResponse<T>> {
    try {
      const {
        prisma,
        entity,
        page = 1,
        limit = 10,
        where = {},
        filters,
        include = {},
        orderBy = { id: 'desc' },
        activatePaginated = true,
        transformFn = (item: any) => item as T,
        buildWhereClause,
        getAdditionalStats,
      } = options;
  
      // Construir cláusula where
      let whereClause = where;
      if (filters && buildWhereClause) {
        whereClause = buildWhereClause(filters);
      }
  
      // console.log(`[PaginationService] Paginando entidad: ${entity}`);
      // console.log(`[PaginationService] whereClause final:`, JSON.stringify(whereClause, null, 2));
  
      // Configuración base
      const queryConfig: any = {
        where: whereClause,
        include,
        orderBy,
      };
  
      // Obtener conteos en paralelo
      let totalItems = 0;
      let additionalStats = {};
  
      try {
        // console.log(`[PaginationService] Ejecutando count para ${entity}...`);
        totalItems = await prisma[entity].count({ where: whereClause });
        // console.log(`[PaginationService] Total de registros encontrados para ${entity}:`, totalItems);
        
        // Si no hay registros, intentar una consulta simple sin filtros para diagnosticar
        if (totalItems === 0) {
          const totalWithoutFilters = await prisma[entity].count();
          // console.log(`[PaginationService] ⚠️ Total de registros en ${entity} SIN filtros:`, totalWithoutFilters);
          
          if (totalWithoutFilters > 0) {
            // console.log(`[PaginationService] ⚠️ Hay ${totalWithoutFilters} registros en la tabla, pero ninguno coincide con los filtros`);
            // console.log(`[PaginationService] ⚠️ Verificar que los datos en la tabla tienen los valores esperados para los filtros aplicados`);
          }
        }
        
        if (getAdditionalStats) {
          additionalStats = await getAdditionalStats();
        }
      } catch (countError) {
        console.error(`[PaginationService] Error counting ${entity}:`, countError);
      }
  
      // Siempre aplicar paginación para evitar saturación del sistema
      // Para grandes datasets, usar límites razonables
      const pageNumber = Math.max(1, page);
      let itemsPerPage = Math.min(500, Math.max(1, limit));
      
      // Para datasets grandes, recomendamos un máximo de 100 registros por página
      // para optimizar el rendimiento del frontend
      if (totalItems > 1000 && itemsPerPage > 100) {
        console.warn(`Dataset grande detectado (${totalItems} registros). Limitando a 100 elementos por página para optimizar rendimiento.`);
        itemsPerPage = 100;
      }
      const totalPages = Math.ceil(totalItems / itemsPerPage);
      
      // Para una implementación más simple y eficiente, obtenemos solo la página solicitada
      // El prefetch se puede hacer en una segunda consulta si es necesario
      const skip = (pageNumber - 1) * itemsPerPage;
      
      // Configurar la consulta para obtener solo los elementos de la página actual
      const mainQueryConfig = {
        ...queryConfig,
        skip,
        take: itemsPerPage,
      };
  
      // Ejecutar consulta principal
      const fetchedItems = await prisma[entity].findMany(mainQueryConfig);
      const transformedItems = fetchedItems.map(transformFn);
  
      // Manejar caso sin resultados
      if (transformedItems.length === 0) {
        return {
          items: [],
          pagination: {
            totalItems: 0,
            currentPage: pageNumber,
            totalPages: 0,
            hasNextPage: false,
            hasPreviousPage: false,
            itemsPerPage,
            ...additionalStats
          },
          nextPages: [],
        };
      }
  
      // Procesar resultados con información optimizada para grandes datasets
      const response = {
        pagination: {
          totalItems,
          itemsPerPage,
          currentPage: pageNumber,
          totalPages,
          hasNextPage: pageNumber < totalPages,
          hasPreviousPage: pageNumber > 1,
          isLargeDataset: totalItems > 1000,
          recommendedPageSize: totalItems > 1000 ? Math.min(100, itemsPerPage) : itemsPerPage,
          ...additionalStats
        },
        items: transformedItems,
        nextPages: [], // Para grandes datasets, no hacer prefetch para optimizar memoria
      };
      
      // Logging para monitoreo de rendimiento
      // if (totalItems > 1000) {
      //   console.log(`[PERFORMANCE] Paginando ${totalItems} registros - Página ${pageNumber}/${totalPages} - ${itemsPerPage} elementos`);
      // }
      
      return response;
    } catch (error) {
      console.error('Error in paginateEntity:', error);
      throw new Error(`Error paginating entity: ${error.message}`);
    }
  }
}