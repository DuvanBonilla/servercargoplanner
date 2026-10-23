import { PartialType } from '@nestjs/swagger';
import { CreateArlDto } from './create-arl.dto';

export class UpdateArlDto extends PartialType(CreateArlDto) {}
