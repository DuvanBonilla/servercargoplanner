import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma, StatusOperation } from '@prisma/client';
import { OperationTransformerService } from './operation-transformer.service';
import { OperationFilterDto } from '../dto/fliter-operation.dto';
import { PaginateOperationService } from 'src/common/services/pagination/operation/paginate-operation.service';
import {
  createOperationInclude,
  OperationIncludeConfig,
} from '../entities/operation-include.types';
import {
  ITransformTariff,
  TariffTransformerService,
} from 'src/tariff/service/tariff-transformer.service';
import { createTariffInclude } from '../../tariff/entities/tariff-include.types';

/**
 * Servicio para buscar operaciones
 */
@Injectable()
export class OperationFinderService {
  // Configuraciones de consulta reutilizables

  private readonly defaultInclude: OperationIncludeConfig =
    createOperationInclude();

  constructor(
    private prisma: PrismaService,
    private transformer: OperationTransformerService,
    private paginationService: PaginateOperationService,
    private tariffTransformer: TariffTransformerService,
  ) {}

  /**
   * Obtiene todas las operaciones con información detallada
   * @returns Lista de operaciones con relaciones incluidas
   */
  async findAll(id_site?: number, id_subsite?: number) {
    try {
      const where: any = {};
      if (typeof id_site === 'number') where.id_site = id_site;
      if (typeof id_subsite === 'number') where.id_subsite = id_subsite;

      const response = await this.prisma.operation.findMany({
        where,
        include: this.defaultInclude,
      });

      return response.map((op) =>
        this.transformer.transformOperationResponse(op),
      );
    } catch (error) {
      console.error('Error getting all operations:', error);
      throw new Error(error.message);
    }
  }

  /**
   * Busca una operación por su ID
   * @param id - ID de la operación a buscar
   * @returns Operación encontrada o mensaje de error
   */
  async findOne(id: number, id_site?: number, id_subsite?: number) {
    try {
      const where: any = { id };
      if (typeof id_site === 'number') where.id_site = id_site;
      if (typeof id_subsite === 'number') where.id_subsite = id_subsite;

      const response = await this.prisma.operation.findFirst({
        where,
        include: {
          ...this.defaultInclude,
          Bill: true,
          // Bill: {
          //   include: {
          //     billDetails: {
          //       include: {
          //         operationWorker: true,
          //       },
          //     },
          //   },
          // },
        },
      });

      if (!response) {
        return { message: 'Operation not found', status: 404 };
      }

      return this.transformer.transformOperationResponse(response);
    } catch (error) {
      console.error(`Error finding operation with ID ${id}:`, error);
      throw new Error(error.message);
    }
  }

  /**
   * Encuentra todas las operaciones con los estados especificados
   * @param statuses - Estados para filtrar las operaciones
   * @returns Lista de operaciones filtradas o mensaje de error
   */
  async findByStatuses(
    statuses: StatusOperation[],
    id_site?: number,
    id_subsite?: number,
  ) {
    try {
      const isCompletedOnly =
        statuses.length === 1 && statuses[0] === StatusOperation.COMPLETED;

      const where: any = {
        status: { in: statuses },
      };
      if (typeof id_site === 'number') where.id_site = id_site;
      if (typeof id_subsite === 'number') where.id_subsite = id_subsite;

      const queryConfig: any = {
        where,
        include: this.defaultInclude,
        orderBy: isCompletedOnly
          ? { dateStart: Prisma.SortOrder.desc }
          : { dateStart: Prisma.SortOrder.asc },
      };

      if (isCompletedOnly) {
        queryConfig['take'] = 30;
      }

      const response = await this.prisma.operation.findMany(queryConfig);

      if (response.length === 0) {
        return {
          message: `No operations found with statuses: ${statuses.join(', ')}`,
          status: 404,
        };
      }

      return response.map((operation) =>
        this.transformer.transformOperationResponse(operation),
      );
    } catch (error) {
      console.error('Error finding operations by status:', error);
      throw new Error(`Error finding operations by status: ${error.message}`);
    }
  }
  /**
   * Busca operaciones por rango de fechas
   * @param start Fecha de inicio
   * @param end Fecha de fin
   * @returns Resultado de la búsqueda
   */
  async findByDateRange(
    start: Date,
    end: Date,
    id_site?: number,
    id_subsite?: number,
  ) {
    try {
      const where: any = {
        dateStart: { gte: start },
        dateEnd: { lte: end },
      };
      if (typeof id_site === 'number') where.id_site = id_site;
      if (typeof id_subsite === 'number') where.id_subsite = id_subsite;

      const response = await this.prisma.operation.findMany({
        where,
        include: this.defaultInclude,
      });

      if (response.length === 0) {
        return { message: 'No operations found in this range', status: 404 };
      }

      return response.map((op) =>
        this.transformer.transformOperationResponse(op),
      );
    } catch (error) {
      console.error('Error finding operations by date range:', error);
      throw new Error(error.message);
    }
  }
  /**
   * Obtiene operaciones con paginación y filtros opcionales
   * @param page Número de página (por defecto: 1)
   * @param limit Elementos por página (por defecto: 10, máximo: 50)
   * @param filters Filtros opcionales para las operaciones
   * @returns Respuesta paginada con los datos actuales y prefetch de las siguientes 2 páginas
   */
  async findAllPaginated(
    page: number = 1,
    limit: number = 10,
    filters?: OperationFilterDto,
    activatePaginated: boolean = true,
  ) {
    try {
      // Usar el servicio de paginación mejorado
      return await this.paginationService.paginateOperations({
        prisma: this.prisma,
        page,
        limit,
        filters,
        activatePaginated,
        defaultInclude: this.defaultInclude,
        transformer: this.transformer,
      });
    } catch (error) {
      console.error('Error finding operations:', error);
      throw new Error(`Error finding operations: ${error.message}`);
    }
  }

  /**
   * Encuentra operaciones asociadas a un usuario específico
   * @param id_user ID del usuario para buscar operaciones
   * @returns Lista de operaciones asociadas al usuario o mensaje de error
   */
  async findByUser(id_user: number, id_site?: number, id_subsite?: number) {
    try {
      const where: any = { id_user };
      if (typeof id_site === 'number') where.id_site = id_site;
      if (typeof id_subsite === 'number') where.id_subsite = id_subsite;

      const response = await this.prisma.operation.findMany({
        where,
        include: this.defaultInclude,
      });

      if (response.length === 0) {
        return { message: 'No operations found for this user', status: 404 };
      }

      return response.map((op) =>
        this.transformer.transformOperationResponse(op),
      );
    } catch (error) {
      console.error(`Error finding operations for user ${id_user}:`, error);
      throw new Error(error.message);
    }
  }

  /**
   * Actualiza la información de la operación para incluir detalles completos de tarifa
   * @param operationId ID de la operación
   */
  async getOperationWithDetailedTariffs(operationId: number) {
    if (!operationId) {
      throw new Error('operationId is required and must be a valid number');
    }
    try {
      // Obtenemos la operación con sus trabajadores y tarifas
      const operation = await this.prisma.operation.findUnique({
        where: { id: operationId },
        include: {
          ...this.defaultInclude,
          workers: {
            select: {
              ...this.defaultInclude.workers.select,
              tariff: {
                include: createTariffInclude(),
              },
            },
          },
        },
      });

      if (!operation) {
        return { message: 'Operation not found', status: 404 };
      }

      // ✅ AGREGAR LOG PARA VERIFICAR op_duration DE LA OPERACIÓN
      console.log('=== OPERATION FINDER ===');
      console.log('operation.op_duration:', operation.op_duration);

      // Transformar la operación con detalles de tarifa
      const transformedOperation =
        this.transformer.transformOperationResponse(operation);

      // ✅ AGREGAR LOG PARA VERIFICAR DESPUÉS DE TRANSFORMACIÓN
      console.log('transformedOperation.op_duration:', transformedOperation.op_duration);
      console.log('transformedOperation.workerGroups length:', transformedOperation.workerGroups.length);

      // Actualizar cada trabajador con detalles completos de tarifa
      transformedOperation.workerGroups.forEach((group, index) => {
        // ✅ OBTENER EL TARIFF_ID CORRECTO DEL PRIMER WORKER DEL GRUPO
        // Como el transformer ya creó grupos únicos por groupId+tariffId, 
        // todos los workers en este grupo DEBEN tener la misma tarifa
        const firstWorkerInGroup = group.workers?.[0];
        if (!firstWorkerInGroup) {
          console.warn(`[FinderService] Grupo ${group.groupId} no tiene trabajadores`);
          return;
        }

        // ✅ BUSCAR EL OPERATION_WORKER RECORD POR worker ID para obtener su tariff
        const firstWorkerRecord = operation.workers.find(
          (w) => w.id_worker === firstWorkerInGroup.id && w.id_group === group.groupId
        );
        
        if (!firstWorkerRecord) {
          console.warn(`[FinderService] No se encontró registro para worker ${firstWorkerInGroup.id} en grupo ${group.groupId}`);
          return;
        }

        const correctTariffId = firstWorkerRecord.tariff?.id;
        console.log(`[FinderService] Grupo ${index + 1} (${group.groupId}) → Usando tariff ${correctTariffId} del worker ${firstWorkerInGroup.id}`);
        const originalWorkers = operation.workers.filter(
          (w) => w.id_group === group.groupId && w.tariff?.id === correctTariffId,
        );

        group.tariffDetails =
          originalWorkers.length > 0 && originalWorkers[0].tariff
            ? {
                ...this.tariffTransformer.transformTariffResponse(
                  originalWorkers[0].tariff as unknown as ITransformTariff,
                ),
                paysheet_tariff: Number(
                  (originalWorkers[0].tariff as any).paysheet_tariff ?? 0,
                ),
                facturation_tariff: Number(
                  (originalWorkers[0].tariff as any).facturation_tariff ?? 0,
                ),
                // ✅ AGREGAR ID ÚNICO PARA VERIFICAR INDEPENDENCIA
                _uniqueId: `${group.groupId}_${correctTariffId}_${Date.now()}`,
              }
            : { 
              paysheet_tariff: 0, 
              facturation_tariff: 0,
              _uniqueId: `${group.groupId}_default_${Date.now()}`,
              };

        // ✅ PROPAGAR op_duration DE LA OPERACIÓN AL GRUPO
        group.op_duration = operation.op_duration;

        // ✅ AGREGAR LOG PARA VERIFICAR PROPAGACIÓN
        console.log(`=== GRUPO ${index + 1} ===`);
        console.log(`Grupo ${group.groupId} - paysheet_tariff:`, group.tariffDetails.paysheet_tariff);
        console.log(`Grupo ${group.groupId} - op_duration:`, group.op_duration);
      });

      // ✅ VERIFICAR QUE op_duration ESTÉ EN LA RESPUESTA FINAL
      console.log('=== RESPUESTA FINAL ===');
      console.log('transformedOperation.op_duration:', transformedOperation.op_duration);
      console.log('Grupos con op_duration:', transformedOperation.workerGroups.map(g => ({
        groupId: g.groupId,
        op_duration: g.op_duration
      })));
      console.log('=== FIN OPERATION FINDER ===');

      return transformedOperation;
    } catch (error) {
      console.error(`Error finding operation with ID ${operationId}:`, error);
      throw new Error(error.message);
    }
  }
}
