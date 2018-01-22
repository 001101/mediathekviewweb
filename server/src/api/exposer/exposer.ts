export interface Exposer {
  expose(path: string[], func: ExposedFunction): void;
}

export type ExposedFunction = (parameters: ExposedFunctionParameters) => Promise<ExposedFunctionResult>;
export type ExposedFunctionParameters = { [key: string]: ExposedFunctionParameterType | ExposedFunctionParameterType[] };
export type ExposedFunctionResult = { result?: any, errors?: ExposedFunctionError[] };
export type ExposedFunctionError = { type: ExposedFunctionErrorType, message?: string };
export type ExposedFunctionErrorType = 'UnknownRequest' | 'InvalidRequest' | 'Unauthorized' | 'NotFound' | 'ServerError';

type ExposedFunctionParameterType = null | number | string | boolean | ExposedFunctionParameters
  | (null | number | string | boolean | ExposedFunctionParameters)[];

export const PATH_VALIDATION_REGEX = /^[a-zA-Z]+[a-zA-Z0-9]+$/;


const a :ExposedFunctionParameters = {a: 5, b:'h', c: {a:[[[[[3]]], ]]}}