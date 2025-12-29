import { Injectable } from '@nestjs/common';
import { CreateConfigurationDto } from './dto/create-configuration.dto';
import { UpdateConfigurationDto } from './dto/update-configuration.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { StatusActivation } from '@prisma/client';

@Injectable()
export class ConfigurationService {
  private configCache: Map<string, { data: any; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutos en milisegundos
  
  constructor(private prisma: PrismaService) {}
  async create(createConfigurationDto: CreateConfigurationDto) {
    try {
      const response = await this.prisma.configuration.create({
        data: createConfigurationDto,
      });
      return response;
    } catch (error) {
      console.error('Error creating configuration:', error);
      throw new Error('Error creating configuration');
    }
  }

  async findAll() {
    try {
      const response = await this.prisma.configuration.findMany();
      if (response.length === 0) {
        return { message: 'No configurations found', status: 404 };
      }
      return response;
    } catch (error) {
      console.error('Error fetching configurations:', error);
      throw new Error('Error fetching configurations');
    }
  }

  async findOneByName(name: string): Promise<any> {
    try {
      // Verificar si existe en caché y si aún es válido
      const cached = this.configCache.get(name);
      const now = Date.now();
      
      if (cached && (now - cached.timestamp) < this.CACHE_TTL) {
        return cached.data;
      }

      const response = await this.prisma.configuration.findFirst({
        where: {
          name: {
            equals: name,
            mode: 'insensitive',
          },
        },
      });
      
      if (!response) {
        return { message: 'Configuration not found', status: 404 };
      }

      // Guardar en caché
      this.configCache.set(name, { data: response, timestamp: now });
      
      return response;
    } catch (error) {
      console.error('Error fetching configuration by name:', error);
      throw new Error('Error fetching configuration by name');
    }
  }

  async findOne(id: number) {
    try {
      const response = await this.prisma.configuration.findUnique({
        where: { id },
      });
      if (!response) {
        return { message: 'Configuration not found', status: 404 };
      }
      return response;
    } catch (error) {
      console.error('Error fetching configuration:', error);
      throw new Error('Error fetching configuration');
    }
  }

  async findByName(name: string) {
    try {
      const response = await this.prisma.configuration.findFirst({
        where: {
          name: {
            contains: name,
            mode: 'insensitive',
          },
          status: StatusActivation.ACTIVE,
        },
      });
      if (!response) {
        return {
          message: `Configuration with name '${name}' not found`,
          status: 404,
        };
      }
      return response;
    } catch (error) {
      console.error('Error fetching configuration by name:', error);
      throw new Error('Error fetching configuration by name');
    }
  }

  async update(id: number, updateConfigurationDto: UpdateConfigurationDto) {
    try {
      const validateId = await this.findOne(id);
      if (validateId['status'] === 404) {
        return validateId;
      }
      const response = await this.prisma.configuration.update({
        where: { id },
        data: updateConfigurationDto,
      });
      
      // Limpiar caché cuando se actualiza una configuración
      this.configCache.clear();
      
      return response;
    } catch (error) {
      console.error('Error updating configuration:', error);
      throw new Error('Error updating configuration');
    }
  }

  async remove(id: number) {
    try {
      const validateId = await this.findOne(id);
      if (validateId['status'] === 404) {
        return validateId;
      }
      const response = await this.prisma.configuration.delete({
        where: { id },
      });
      return response;
    } catch (error) {
      console.error('Error removing configuration:', error);
      throw new Error('Error removing configuration');
    }
  }
}
