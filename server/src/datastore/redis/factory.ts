import { uniqueId } from '@common-ts/server/utils';
import * as Redis from 'ioredis';
import { DataType } from '../data-type';
import { DatastoreFactory } from '../factory';
import { Set } from '../set';
import { RedisKey } from './key';
import { RedisMap } from './map';
import { RedisSet } from './set';

interface RedisDatastoreConstructable<TInstance> {
  new(redis: Redis.Redis, key: string, dataType: DataType): TInstance;
}

export class RedisDatastoreFactory implements DatastoreFactory {
  private readonly redis: Redis.Redis;

  constructor(redis: Redis.Redis) {
    this.redis = redis;
  }

  key<T>(dataType: DataType): RedisKey<T>;
  key<T>(key: string, dataType: DataType): RedisKey<T>;
  key<T>(keyOrDataType: string | DataType, dataType?: DataType): RedisKey<T> {
    return this.construct(RedisKey, keyOrDataType, dataType) as RedisKey<any>;
  }

  set<T>(dataType: DataType): Set<T>;
  set<T>(key: string, dataType: DataType): Set<T>;
  set<T>(keyOrDataType: string | DataType, dataType?: DataType): Set<T> {
    return this.construct(RedisSet, keyOrDataType, dataType) as RedisSet<any>;
  }

  map<T>(dataType: DataType): RedisMap<T>;
  map<T>(key: string, dataType: DataType): RedisMap<T>;
  map<T>(keyOrDataType: string | DataType, dataType?: DataType): RedisMap<T> {
    return this.construct(RedisMap, keyOrDataType, dataType) as RedisMap<any>;
  }

  private construct<TInstance>(datastore: RedisDatastoreConstructable<TInstance>, keyOrDataType: string | DataType, dataTypeOrUndefined: DataType | undefined): TInstance {
    const key = (typeof keyOrDataType == 'string')
      ? `datastore:${keyOrDataType}`
      : this.getUniqueKey();

    const dataType = (typeof keyOrDataType != 'string')
      ? keyOrDataType
      : dataTypeOrUndefined as DataType;

    return new datastore(this.redis, key, dataType);
  }

  private getUniqueKey(): string {
    const id = uniqueId(20);
    return `unnamed:${id}`;
  }
}
