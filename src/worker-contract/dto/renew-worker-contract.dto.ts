import { PickType } from '@nestjs/swagger';
import { CreateWorkerContractDto } from './create-worker-contract.dto';

// La renovación toma empresa, tipo de trabajador y modalidad del contrato
// renovado; solo se puede confirmar otra fecha de terminación.
export class RenewWorkerContractDto extends PickType(CreateWorkerContractDto, ['endDate', 'months'] as const) {}
