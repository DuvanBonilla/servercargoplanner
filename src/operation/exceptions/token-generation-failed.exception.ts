import { InternalServerErrorException } from '@nestjs/common';

export class TokenGenerationFailedException extends InternalServerErrorException {
  constructor(operationId: number, details?: string) {
    super(
      details ||
        `No se pudo generar token de confirmacion para la operacion ${operationId}`,
    );
  }
}
