import { Injectable } from '@nestjs/common';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { PrismaService } from 'src/prisma/prisma.service';

/**
 * Servicio para gestionar tareas
 * @class TaskService
 */
@Injectable()
export class TaskService {
  constructor(private prisma: PrismaService) {}
  /**
   * crear una tarea
   * @param createTaskDto datos de la tarea a crear
   * @returns respuesta de la creacion de la tarea
   */
  async create(createTaskDto: CreateTaskDto) {
    try {
      const { name, id_site, id_subsite } = createTaskDto;

      const validateTask = await this.findOneTaskName(
        name,
        id_site,
        id_subsite,
      );
      if (validateTask['status'] !== 404) {
        return { message: 'Task already exists', status: 409 };
      }
      if (createTaskDto.id_user === undefined) {
        return { message: 'User ID is required', status: 400 };
      }

      const response = await this.prisma.task.create({
        data: {
          name: name,
          id_user: createTaskDto.id_user,
          id_site: createTaskDto.id_site,
          id_subsite: createTaskDto.id_subsite,
          status: 'ACTIVE',
        },
      });


      return response;
    } catch (error) {
      console.error('Error creating task:', error);
      throw new Error('Error create Task');
    }
  }

  /**
   * obtener una tarea por su nombre
   * @param name nombre de la tarea a buscar
   * @returns respuesta de la busqueda de la tarea
   */
  async findOneTaskName(
    name: string,
    id_site?: number,
    id_subsite?: number | null,
  ) {
    try {
      const response = await this.prisma.task.findMany({
        where: {
          id_site: id_site,
          // id_subsite: id_subsite,
          name: name,
          // name: {
          //   equals: name,
          //   // mode: 'insensitive',
          // },
        },
      });
      if (response.length === 0) {
        return { message: 'Task name not found', status: 404 };
      }
      return response;
    } catch (error) {
      throw new Error('Error get Task');
    }
  }
  /**
   * obtener todas las tareas
   * @returns respuesta de la busqueda de todas las tareas
   */
  async findAll(id_site?: number, id_subsite?: number | null) {
  try {
    let whereClause: any = {};

    if (id_site) {
      whereClause.id_site = id_site;
    }

    const response = await this.prisma.task.findMany({
      where: whereClause,
      include: {
        SubTask: id_subsite == null
          ? { // Si subsite es null, trae todas las subtasks
              include: {
                Tariff: {
                  select: {
                    id: true,
                    code: true,
                  },
                },
              },
            }
          : { // Si subsite es number, filtra las subtasks por subsite
              where: {
                id_subsite: id_subsite,
              },
              include: {
                Tariff: {
                  select: {
                    id: true,
                    code: true,
                  },
                },
              },
            },
      },
    });
    return response;
  } catch (error) {
    throw new Error('Error get all Task');
  }
}
  /**
   * obtener una tarea por su ID
   * @param id id de la tarea a buscar
   * @returns respuesta de la busqueda de la tarea
   */
  async findOne(id: number, id_site?: number) {
  try {
    const response = await this.prisma.task.findFirst({
      where: {
        id: id,
        id_site: id_site,
      },
      include: {
        SubTask: {
          include: {
            Tariff: {
              select: {
                id: true,
                code: true,
              },
            },
          },
        },
      },
    });
    if (!response) {
      return { message: 'Task not found', status: 404 };
    }
    // // Si no hay subtasks asociadas, retorna error 404 específico
    // if (!response.SubTask || response.SubTask.length === 0) {
    //   return { message: 'No subtasks found', status: 404 };
    // }
    return response;
  } catch (error) {
    throw new Error('Error get Task');
  }
}
  /**
   * actualizar una tarea
   * @param id id  de la tarea a actualizar
   * @param updateTaskDto datos de la tarea a actualizar
   * @returns respuesta de la actualizacion de la tarea
   */
  async update(id: number, updateTaskDto: UpdateTaskDto, id_site?: number) {
    try {
      const validateTask = await this.findOne(id, id_site); // Pasar id_site aquí
      if (validateTask['status'] === 404) {
        return validateTask;
      }

      if (updateTaskDto.name && updateTaskDto.id_user) {
        const validateName = await this.findOneTaskName(
          updateTaskDto.name,
          id_site,
          // updateTaskDto.id_subsite
        ); // Pasar parámetros de site y subsite
        if (validateName['status'] !== 404) {
          return { message: 'Task already exists', status: 409 };
        }
      }
      const response = await this.prisma.task.update({
        where: { id: id },
        data: updateTaskDto,
      });
      return response;
    } catch (error) {
      throw new Error('Error update Task');
    }
  }
  /**
   * eliminar una tarea
   * @param id tarea a eliminar
   * @returns respuesta de la eliminacion de la tarea
   */
  async remove(id: number) {
    try {
      const validateTask = await this.findOne(id);
      if (validateTask['status'] === 404) {
        return validateTask;
      }
      const response = await this.prisma.task.delete({
        where: { id: id },
      });
      return response;
    } catch (error) {
      throw new Error('Error delete Task');
    }
  }
}
