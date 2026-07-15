import { NotFoundException } from '@nestjs/common';

export class OperationNotFoundException extends NotFoundException {
  constructor(operationId: number) {
    super(`Operacion ${operationId} no encontrada`);
  }
}
