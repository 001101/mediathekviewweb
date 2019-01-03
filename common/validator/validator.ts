import '../extensions/set';
import { ObjectValidationResultBuilder } from './object-validation-result-builder';

export type PropertyValidationError = {
  message: string,
  hint?: string
};

export type PropertyValidationResult =
  | null
  | PropertyValidationError
  | PropertyValidationError[]
  | ObjectValidationResult
  | { [key: string]: PropertyValidationResult }
  | { [key: number]: PropertyValidationResult };

export type ObjectValidationResult = {
  valid?: true,
  missing?: string[],
  unknown?: string[],
  errors?: StringMap<PropertyValidationResult>
};

export type PropertyValidationFunction<T = unknown> = (value: T) => PropertyValidationResult;

export abstract class ObjectValidator<T extends object = any> {
  protected abstract readonly required: ReadonlyArray<string>;
  protected abstract readonly optional: ReadonlyArray<string>;
  protected abstract readonly propertyValidators: { [P in keyof Required<T>]: PropertyValidationFunction<Required<T>[P]> };
  // protected abstract propertyValidators: { [P in keyof T]: PropertyValidationFunction<T[P]> };

  validate(object: unknown): ObjectValidationResult {
    const resultBuilder = new ObjectValidationResultBuilder();

    if (object == null) {
      object = {};
    }

    const propertyNames = Object.getOwnPropertyNames(object);
    const properties = new Set(propertyNames);

    const required = new Set(this.required);
    const optional = new Set(this.optional);

    const missingProperties = required.difference(properties);
    const unknownProperties = properties.difference(required, optional);
    const knownProperties = required.union(optional).intersect(properties);

    if (missingProperties.size > 0) {
      resultBuilder.addMissing(...missingProperties);
    }

    if (unknownProperties.size > 0) {
      resultBuilder.addMissing(...unknownProperties);
    }

    for (const property of knownProperties) {
      const value = (object as any)[property];
      const propertyValidation = this.propertyValidators[property as keyof T](value);

      if (propertyValidation != null) {
        resultBuilder.setProperty(property, propertyValidation);
      }
    }

    const result = resultBuilder.build();
    return result;
  }
}
