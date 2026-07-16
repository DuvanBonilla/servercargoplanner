import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateClientEmailDto } from './dto/create-client-email.dto';
import { UpdateClientEmailDto } from './dto/update-client-email.dto';
import { UpdateClientEmailStatusDto } from './dto/deactiveStatus-client-email.dto';

/**
 * Servicio para gestionar los correos de los clientes
 */
@Injectable()
export class ClientEmailService {
  constructor(private prisma: PrismaService) {}

  /**
   * Crear un correo para un cliente
   */
  async create(createClientEmailDto: CreateClientEmailDto) {
    try {
      const client = await this.prisma.client.findUnique({
        where: {
          id: createClientEmailDto.id_client,
        },
        select: {
          id: true,
        },
      });

      if (!client) {
        return {
          message: 'Client not found',
          status: 404,
        };
      }

     const existEmail = await this.prisma.clientEmail.findFirst({
  where: {
    id_client: createClientEmailDto.id_client,
    email: createClientEmailDto.email,
    type: createClientEmailDto.type,
  },
  select: {
    id: true,
  },
});

      if (existEmail) {
        return {
          message: 'Email already registered for this client',
          status: 400,
        };
      }

      const response = await this.prisma.clientEmail.create({
        data: {
          ...createClientEmailDto,
        },
        select: {
          id: true,
          id_client: true,
          email: true,
          type: true,
          name: true,
          status: true,
        },
      });

      return response;
    } catch (error) {
      throw new Error(`Error: ${(error as Error).message}`);
    }
  }

  /**
   * Obtiene todos los correos de un cliente
   */
  async findByClient(idClient: number) {
    try {
      const client = await this.prisma.client.findUnique({
        where: {
          id: idClient,
        },
        select: {
          id: true,
          name: true,
        },
      });

      if (!client) {
        return {
          message: 'Client not found',
          status: 404,
        };
      }

      const emails = await this.prisma.clientEmail.findMany({
        where: {
          id_client: idClient,
        },
        select: {
          id: true,
          email: true,
          type: true,
          name: true,
          status: true,
        },
        orderBy: {
          type: 'asc',
        },
      });

      return {
        ...client,
        emails,
      };
    } catch (error) {
      throw new Error(`Error: ${(error as Error).message}`);
    }
  }

  /**
   * Obtiene un correo por ID
   */
  async findOne(id: number) {
    try {
      const response = await this.prisma.clientEmail.findUnique({
        where: {
          id,
        },
        select: {
          id: true,
          id_client: true,
          email: true,
          type: true,
          name: true,
          status: true,
        },
      });

      if (!response) {
        return {
          message: 'Client email not found',
          status: 404,
        };
      }

      return response;
    } catch (error) {
      throw new Error(`Error: ${(error as Error).message}`);
    }
  }

/**
 * Actualiza un correo
 */
async update(id: number, updateClientEmailDto: UpdateClientEmailDto) {
  try {
    // Validar que exista el correo
    const currentEmail = await this.prisma.clientEmail.findUnique({
      where: {
        id,
      },
      select: {
        id: true,
        id_client: true,
        email: true,
        type: true,
        name: true,
        status: true,
      },
    });

    if (!currentEmail) {
      return {
        message: 'Client email not found',
        status: 404,
      };
    }

    // Valores finales que tendrá el registro
    const email = updateClientEmailDto.email ?? currentEmail.email;
    const type = updateClientEmailDto.type ?? currentEmail.type;

    // Validar duplicado únicamente si cambia el correo o el tipo
    if (
      email !== currentEmail.email ||
      type !== currentEmail.type
    ) {
      const existEmail = await this.prisma.clientEmail.findFirst({
        where: {
          id_client: currentEmail.id_client,
          email,
          type,
          NOT: {
            id,
          },
        },
        select: {
          id: true,
        },
      });

      if (existEmail) {
        return {
          message: 'Email already registered for this client',
          status: 400,
        };
      }
    }

    /**
     * Construir únicamente los campos permitidos para actualizar.
     * Esto evita enviar propiedades como:
     * id
     * id_client
     * clientName
     */
    const data: UpdateClientEmailDto = {};

    if (updateClientEmailDto.email !== undefined) {
      data.email = updateClientEmailDto.email;
    }

    if (updateClientEmailDto.name !== undefined) {
      data.name = updateClientEmailDto.name;
    }

    if (updateClientEmailDto.type !== undefined) {
      data.type = updateClientEmailDto.type;
    }

    if (updateClientEmailDto.status !== undefined) {
      data.status = updateClientEmailDto.status;
    }

    const response = await this.prisma.clientEmail.update({
      where: {
        id,
      },
      data,
      select: {
        id: true,
        id_client: true,
        email: true,
        type: true,
        name: true,
        status: true,
      },
    });

    return response;
  } catch (error) {
    throw new Error(`Error: ${(error as Error).message}`);
  }
}
  async findAll() {
    try {

        const emails = await this.prisma.clientEmail.findMany({
            select: {
                id: true,
                id_client: true,
                email: true,
                name: true,
                type: true,
                status: true,
            },
            orderBy: {
                id: "desc",
            },
        });

        const clients = await this.prisma.client.findMany({
            select: {
                id: true,
                name: true,
            },
        });

        const clientMap = new Map(
            clients.map(client => [client.id, client.name])
        );

        return emails.map(email => ({
            ...email,
            clientName: clientMap.get(email.id_client) ?? "",
        }));

    } catch (error) {
        throw new Error((error as Error).message);
    }
}

  /**
   * Elimina un correo
   */
  async remove(id: number) {
    try {
      const validateEmail = await this.findOne(id);

      if (validateEmail['status'] === 404) {
        return validateEmail;
      }

      const response = await this.prisma.clientEmail.delete({
        where: {
          id,
        },
        select: {
          id: true,
          email: true,
        },
      });

      return response;
    } catch (error) {
      throw new Error(`Error: ${(error as Error).message}`);
    }
  }

  async updateStatus(
    id:number,
    dto:UpdateClientEmailStatusDto,
){

    const email = await this.prisma.clientEmail.findUnique({
        where:{
            id
        },
        select:{
            id:true
        }
    });

    if(!email){
        return{
            message:'Client email not found',
            status:404
        }
    }

    return await this.prisma.clientEmail.update({
        where:{
            id
        },
        data:{
            status:dto.status
        },
        select:{
            id:true,
            status:true
        }
    });

}
}