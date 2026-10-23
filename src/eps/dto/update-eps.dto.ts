import { PartialType } from '@nestjs/swagger';
import { CreateEpsDto } from './create-eps.dto';

export class UpdateEpsDto extends PartialType(CreateEpsDto) {}
