import { Injectable } from '@nestjs/common';
import { CreateClientProgrammingDto } from './dto/create-client-programming.dto';
import { UpdateClientProgrammingDto } from './dto/update-client-programming.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { FilterClientProgrammingDto } from './dto/filter-client-programming.dto';
import { ValidationClientProgrammingService } from 'src/common/validation/services/validation-client-programming/validation-client-programming.service';

@Injectable()
export class ClientProgrammingService {
  constructor(
    private prisma: PrismaService,
    private validationClientProgramming: ValidationClientProgrammingService
  ) {}
  async create(createClientProgrammingDto: CreateClientProgrammingDto) {
    try {
      const validationProgramming =

        await this.validationClientProgramming.validateClientProgramming({
          // service_request: createClientProgrammingDto.service_request,
          service: createClientProgrammingDto.service,
          client: createClientProgrammingDto.client,
          ubication: createClientProgrammingDto.ubication,
          dateStart: createClientProgrammingDto.dateStart,
          timeStart: createClientProgrammingDto.timeStart,
        });
      if (
        (validationProgramming &&
          'status' in validationProgramming &&
          validationProgramming.status === 409) ||
        (validationProgramming && validationProgramming.status === 404)
      ) {

        console.error('Validation failed:', validationProgramming);

        return validationProgramming;
      }

      const response = await this.prisma.clientProgramming.create({
        data: {
          ...createClientProgrammingDto,
        },
      });
      return response;
    } catch (error) {
      throw new Error('Failed to create client programming');
    }
  }

  async findAll(id_site?: number) {
    try {
      const response = await this.prisma.clientProgramming.findMany({
        where: {
          id_site,
        },
      });
      if (!response || response.length === 0) {
        return {
          status: 404,
          message: 'Not Found Client Programming',
        };
      }
      return response;
    } catch (error) {
      throw new Error('Failed to fetch client programming');
    }
  }

  async findOne(id: number, id_site?: number) {
    try {
      const response = await this.prisma.clientProgramming.findUnique({
        where: {
          id,
        },
      });
      if (!response || Object.keys(response).length === 0) {
        return {
          status: 404,
          message: 'Not Found Client Programming',
        };
      }
      // Validar que pertenezca al site del usuario si se proporciona
      if (id_site !== null && id_site !== undefined && response.id_site !== id_site) {
        return {
          status: 403,
          message: 'No tienes permiso para acceder a esta programación',
        };
      }
      return response;
    } catch (error) {
      throw new Error('Failed to fetch client programming');
    }
  }

  async findAllFiltered(filters: FilterClientProgrammingDto, id_site?: number) {
    try {
      // Construir el objeto where dinámicamente
      const whereConditions: any = {};

      // Filtro por fecha de inicio
      if (filters.dateStart) {
        whereConditions.dateStart = filters.dateStart;
      }

      if (filters.status) {
        whereConditions.status = filters.status[0];
      }

      if (id_site !== undefined) {
        whereConditions.id_site = id_site;
      }
      //  else {
      //   // Por defecto solo traer UNASSIGNED
      //   whereConditions.status = StatusComplete.UNASSIGNED;
      // }

      // Filtro por texto de búsqueda
      if (filters.search) {
        whereConditions.OR = [
          { service: { contains: filters.search, mode: 'insensitive' } },
          { client: { contains: filters.search, mode: 'insensitive' } },
          { ubication: { contains: filters.search, mode: 'insensitive' } },
        ];
      }

      const response = await this.prisma.clientProgramming.findMany({
        where: whereConditions,
        orderBy: [{ dateStart: 'asc' }],
      });

      if (!response || response.length === 0) {
        return {
          status: 404,
          message: 'No client programming found with the specified filters',
          filters: filters,
          count: 0,
          data: [],
        };
      }

      return response;
    } catch (error) {
      console.error('Error filtering client programming:', error);
      throw new Error('Failed to filter client programming');
    }
  }

  async update(
    id: number,
    updateClientProgrammingDto: UpdateClientProgrammingDto,
  ) {
    try {
      const validateId = await this.findOne(id);
      if (validateId && 'status' in validateId && validateId.status === 404) {
        return validateId;
      }
      const response = await this.prisma.clientProgramming.update({
        where: {
          id,
        },
        data: {
          ...updateClientProgrammingDto,
        },
      });
      return response;
    } catch (error) {
      throw new Error('Failed to update client programming');
    }
  }

  async remove(id: number, id_site?: number) {
    try {
      const validateId = await this.findOne(id);
      if (validateId && 'status' in validateId && validateId.status === 404) {
        return validateId;
      }
      // Validar que el usuario tenga permiso en ese site
      if (id_site !== null && id_site !== undefined) {
        const validateSite = validateId['id_site'];
        if (validateSite !== id_site) {
          return {
            message: 'Not authorized to delete this client programming',
            status: 403,
          };
        }
      }
      const response = await this.prisma.clientProgramming.delete({
        where: { id },
      });
      return response;
    } catch (error) {
      throw new Error('Failed to delete client programming');
    }
  }
}
