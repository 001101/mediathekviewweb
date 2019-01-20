import { Undefinable } from '../common/types';

export interface Key<T> {
  set(value: T): Promise<void>;
  get(): Promise<Undefinable<T>>;
  exists(): Promise<boolean>;
  delete(): Promise<boolean>;
}
