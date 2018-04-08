import { ComparisonOperator } from './comparison-operator';
import { LogicalOperator } from './logical-operator';
import { ElementOperator } from './element-operator';
import { EvaluationOperator, WhereEvaluation } from './evaluation-operator';
import { ArrayOperator } from './array-operator';
import { BitOperator } from './bit-operator';
import { ObjectID } from 'mongodb';

type EqualType = string | number | Date | ObjectID | RegExp

export type MongoFilter = WhereEvaluation | ComparisonOperator | LogicalOperator | ElementOperator | EvaluationOperator | ArrayOperator | BitOperator | StringMap<EqualType | EqualType[]>
export type TypedMongoFilter<T> = Partial<Record<keyof T, MongoFilter | EqualType | EqualType[]>> & { _id?: any };