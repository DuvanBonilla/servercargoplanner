import { PartialType } from '@nestjs/swagger';
import { CreateZoneDto } from './create-zone.dto';

// DTO de entrada para actualizar una zona (PATCH /zone/:id)
// Reutiliza CreateZoneDto pero con todos los campos opcionales (PartialType)
export class UpdateZoneDto extends PartialType(CreateZoneDto) {}
