import {
  Controller,
  Post,
  Body,
  Delete,
  Param,
  Get,
  ParseIntPipe,
  UseGuards,
  UsePipes,
  Patch,
} from '@nestjs/common';
import { OperationWorkerService } from './operation-worker.service';
import { AssignWorkersDto } from './dto/assign-workers.dto';
import { RemoveWorkersDto } from './dto/remove-workers.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { DateTransformPipe } from 'src/pipes/date-transform/date-transform.pipe';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { WorkerScheduleDto } from './dto/worker-schedule.dto';
import { UpdateWorkersScheduleDto } from './dto/update-workers-schedule.dto';
@ApiTags('Operation Workers')
@Controller('operation-worker')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPERVISOR, Role.ADMIN, Role.SUPERADMIN)
@ApiBearerAuth('access-token')
export class OperationWorkerController {
  constructor(
    private readonly operationWorkerService: OperationWorkerService,
  ) {}

  @Post('assign')
  @ApiOperation({ summary: 'Asignar trabajadores a una operación' })
  @ApiResponse({
    status: 201,
    description: 'Trabajadores asignados exitosamente',
  })
  @ApiResponse({
    status: 404,
    description: 'Operación o trabajadores no encontrados',
  })
  @UsePipes(new DateTransformPipe())
  assignWorkers(@Body() assignWorkersDto: AssignWorkersDto) {
    const timestamp = new Date().toISOString();
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${timestamp}] 📥 PETICIÓN RECIBIDA: POST /operation-worker/assign`);
    console.log(`[OperationWorkerController] Operación ID: ${assignWorkersDto.id_operation}`);
    console.log(`[OperationWorkerController] Workers simples: ${assignWorkersDto.workerIds?.length || 0}`);
    console.log(`[OperationWorkerController] Grupos programados: ${assignWorkersDto.workersWithSchedule?.length || 0}`);
    if (assignWorkersDto.workersWithSchedule?.length) {
      assignWorkersDto.workersWithSchedule.forEach((group, i) => {
        console.log(`  - Grupo ${i + 1}: ${group.workerIds?.length || 0} workers, id_group: ${group.id_group || 'nuevo'}`);
      });
    }
    console.log(`${'='.repeat(80)}\n`);
    
    return this.operationWorkerService.assignWorkersToOperation(
      assignWorkersDto,
    );
  }

  @Post('remove')
  @ApiOperation({ summary: 'Remover trabajadores de una operación' })
  @ApiResponse({
    status: 200,
    description: 'Trabajadores removidos exitosamente',
  })
  @ApiResponse({
    status: 404,
    description: 'Operación o trabajadores no encontrados',
  })
  removeWorkers(@Body() removeWorkersDto: RemoveWorkersDto) {
    return this.operationWorkerService.removeWorkersFromOperation(
      removeWorkersDto,
    );
  }

  @Delete(':id_operation/release-all')
  @ApiOperation({ summary: 'Liberar todos los trabajadores de una operación' })
  @ApiResponse({
    status: 200,
    description: 'Trabajadores liberados exitosamente',
  })
  @ApiResponse({ status: 404, description: 'Operación no encontrada' })
  releaseAllWorkers(@Param('id_operation', ParseIntPipe) id_operation: number) {
    return this.operationWorkerService.releaseAllWorkersFromOperation(
      id_operation,
    );
  }

  @Get(':id_operation/workers')
  @ApiOperation({ summary: 'Obtener trabajadores asignados a una operación' })
  @ApiResponse({ status: 200, description: 'Listado de trabajadores' })
  @ApiResponse({ status: 404, description: 'Operación no encontrada' })
  getWorkers(@Param('id_operation', ParseIntPipe) id_operation: number) {
    return this.operationWorkerService.getWorkersFromOperation(id_operation);
  }

  @Patch('finalize-group')
  async finalizeGroup(
    @Body()
    body: {
      id_operation: number;
      id_group: number;
      dateEnd: Date;
      timeEnd: string;
    },
  ) {
    return this.operationWorkerService.finalizeGroup(
      body.id_operation,
      body.id_group,
      body.dateEnd,
      body.timeEnd,
    );
  }

  @Post('update-schedule')
  @ApiOperation({
    summary: 'Actualizar programación de trabajadores en una operación',
  })
  @ApiResponse({
    status: 200,
    description: 'Programación actualizada exitosamente',
  })
  @ApiResponse({
    status: 404,
    description: 'Operación o trabajadores no encontrados',
  })
  updateWorkersSchedule(@Body() dto: UpdateWorkersScheduleDto) {
    return this.operationWorkerService.updateWorkersSchedule(
      dto.id_operation,
      dto.workersToUpdate,
    );
  }
}
