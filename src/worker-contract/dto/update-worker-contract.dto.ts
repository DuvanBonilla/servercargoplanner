import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateWorkerContractDto } from './create-worker-contract.dto';

// El trabajador de un contrato no se cambia: se crea otro contrato
export class UpdateWorkerContractDto extends PartialType(
  OmitType(CreateWorkerContractDto, ['id_worker', 'id_user'] as const),
) {}
