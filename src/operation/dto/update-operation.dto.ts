import { PartialType, OmitType, ApiProperty } from '@nestjs/swagger';
import { CreateOperationDto } from './create-operation.dto';
import { IsArray, IsNumber, IsOptional, ValidateNested, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { WorkerScheduleDto } from 'src/operation-worker/dto/worker-schedule.dto';

// Omitimos los campos de relación del DTO base
class OperationUpdateBaseDto extends OmitType(CreateOperationDto, [
  'id_user',
  'id_area',
  'id_task', 
  'id_client',
  'workerIds',
  'inChargedIds',
  'groups'
] as const) {}

export class WorkerDisconnect {
  @ApiProperty({ example: 5 })
  @IsNumber()
  id: number;

  @ApiProperty({ 
    example: "bc5a073b-e861-4825-a718-6ec81f46404f",
    required: false,
    description: "Si se proporciona, solo desconecta del grupo específico. Si no, desconecta de toda la operación."
  })
  @IsOptional()
  @IsString()
  id_group?: string;
}

// Tipo para conectar trabajadores simples (por ID)
export class SimpleWorkerConnect {
  @ApiProperty({ example: 1 })
  @IsNumber()
  id: number;
}

// DTO específico para la conexión de trabajadores programados
export class ScheduledWorkerConnect extends WorkerScheduleDto {}

export class WorkerUpdate {
  @ApiProperty({ example: 1 })
  @IsNumber()
  id_worker: number;

  @ApiProperty({ example: "bc5a073b-e861-4825-a718-6ec81f46404f" })
  @IsString()
  id_group: string;

  @ApiProperty({ example: 1, required: false })
  @IsOptional()
  @IsNumber()
  id_task?: number;
  
  @ApiProperty({ example: 1, required: false })
  @IsOptional()
  @IsNumber()
  id_subtask?: number;

  @ApiProperty({ example: 1, required: false })
  @IsOptional()
  @IsNumber()
  id_tariff?: number;

  @ApiProperty({ example: "2023-10-01", required: false })
  @IsOptional()
  @IsString()
  dateStart?: string;

  @ApiProperty({ example: "2023-10-31", required: false })
  @IsOptional()
  @IsString()
  dateEnd?: string;

  @ApiProperty({ example: "08:00", required: false })
  @IsOptional()
  @IsString()
  timeStart?: string;

  @ApiProperty({ example: "17:00", required: false })
  @IsOptional()
  @IsString()
  timeEnd?: string;

  @ApiProperty({ example: "Observación del trabajo", required: false })
  @IsOptional()
  @IsString()
  observation?: string;
}

// Hacemos los campos restantes opcionales
export class UpdateOperationDto extends PartialType(OperationUpdateBaseDto) {
  // Si aún necesitas actualizar workers, usa un formato que Prisma pueda entender
  @ApiProperty({
    type: Object,
    required: false,
    example: {
      connect: [{ id: 1 }],
      update: [{
        id_worker: 3,
        id_group: "UID-12345",
        id_task: 1,
        id_tariff: 1,
        dateStart: "2023-11-01",
        dateEnd: "2023-11-15",
        timeStart: "09:00",
        timeEnd: "18:00",
        observation: "Observación del trabajo"
      }],
      disconnect: [{ id: 5, id_group: "UID-12345" }]
    }
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => Object)
  workers?: {
    connect?: SimpleWorkerConnect[];
    update?: WorkerUpdate[];
    disconnect?: WorkerDisconnect[];
  };
  // Si aún necesitas actualizar inCharged, usa un formato que Prisma pueda entender
  @ApiProperty({ 
    type: Object, 
    required: false,
    example: { 
      connect: [{ id: 1 }, { id: 2 }],
      disconnect: [{ id: 3 }]
    } 
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => Object)
  inCharged?: {
    connect?: Array<{ id: number }>;
    disconnect?: Array<{ id: number }>;
  };
  // ✅ AGREGAR CAMPO GROUPS PARA FINALIZACIÓN DE GRUPOS
  @ApiProperty({
    type: Array,
    required: false,
    description: 'Array de grupos para finalizar con fechas, horas de finalización y observaciones',
    example: [
      {
        groupId: "5ee050fd-85b7-4389-b2e6-cb07e3d56d37",
        dateEnd: "2025-11-06",
        timeEnd: "08:05",
        observation: "Trabajo completado exitosamente",
        isNewGroup: false
      }
    ]
  })
  @IsOptional()
  @IsArray()
  groups?: Array<{
    groupId: string;
    dateEnd?: string;
    timeEnd?: string;
    observation?: string;
    isNewGroup?: boolean;
  }>;
}