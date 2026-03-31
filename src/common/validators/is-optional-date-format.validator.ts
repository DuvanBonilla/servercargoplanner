import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

/**
 * Validador personalizado para fechas opcionales
 * Permite null/undefined, pero si tiene valor, debe estar en formato YYYY-MM-DD
 */
@ValidatorConstraint({ name: 'isOptionalDateFormat', async: false })
export class IsOptionalDateFormatConstraint
  implements ValidatorConstraintInterface
{
  validate(value: any): boolean {
    // Permitir null, undefined, o cadena vacía
    if (value === null || value === undefined || value === '') {
      return true;
    }

    // Si tiene valor, debe cumplir el patrón YYYY-MM-DD
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  defaultMessage(): string {
    return 'La fecha debe estar en formato YYYY-MM-DD o ser null/undefined';
  }
}

/**
 * Decorador para validar fechas opcionales
 * @example
 * @IsOptionalDateFormat()
 * dateRetierment?: string;
 */
export function IsOptionalDateFormat(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return function (target: Object, propertyName: string | symbol) {
    registerDecorator({
      target: target.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      constraints: [],
      validator: IsOptionalDateFormatConstraint,
    });
  };
}
