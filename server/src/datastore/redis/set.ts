import * as Redis from 'ioredis';

import { DataType, Set } from '../';
import { AsyncEnumerable } from '../../common/enumerable';
import { AnyIterable, Nullable } from '../../common/utils';
import { BATCH_SIZE, CONCURRENCY } from './constants';
import { SerializeFunction, getSerializer, getDeserializer, DeserializeFunction } from './serializer';

export class RedisSet<T> implements Set<T> {
  private readonly redis: Redis.Redis;
  private readonly key: string;

  private serialize: SerializeFunction<T>;
  private deserialize: DeserializeFunction<T>;

  constructor(redis: Redis.Redis, key: string, dataType: DataType) {
    this.key = key;
    this.redis = redis;

    this.serialize = getSerializer(dataType);
    this.deserialize = getDeserializer(dataType);
  }

  add(value: T): Promise<void> {
    const serialized = this.serialize(value);
    return this.redis.sadd(this.key, serialized);
  }

  addMany(iterable: AnyIterable<T>): Promise<void> {
    return AsyncEnumerable.from(iterable)
      .map(this.serialize)
      .batch(BATCH_SIZE)
      .parallelForEach(3, async (batch) => {
        await this.redis.sadd(this.key, ...batch);
      });
  }

  async has(value: T): Promise<boolean> {
    const serialized = this.serialize(value);
    const result = await this.redis.sismember(this.key, serialized);

    return result == 1;
  }

  hasMany(iterable: AnyIterable<T>): AsyncIterable<boolean> {
    return AsyncEnumerable.from(iterable)
      .map(this.serialize)
      .batch(BATCH_SIZE)
      .parallelMap(3, true, (batch) => this.hasPipeline(batch))
      .mapMany((results) => results);
  }

  async delete(value: T): Promise<void> {
    const serialized = this.serialize(value);
    await this.redis.srem(serialized);
  }

  deleteMany(iterable: AnyIterable<T>): Promise<void> {
    return AsyncEnumerable.from(iterable)
      .map(this.serialize)
      .batch(BATCH_SIZE)
      .parallelForEach(CONCURRENCY, async (batch) => {
        await this.redis.srem(this.key, ...batch);
      });
  }

  pop(): Promise<Undefinable<T>>;
  pop(count: number): AsyncIterable<T>;
  pop(count?: number): Promise<Undefinable<T>> | AsyncIterable<T> {
    let result: Promise<T> | AsyncIterable<T>;

    if (count == null) {
      result = this.popOne();
    } else {
      result = this.popMany(count);
    }

    return result;
  }

  async *values(): AsyncIterable<T> {
    const serialized: string[] = await this.redis.smembers(this.key);
    const values = serialized.map(this.deserialize);

    yield* values;
  }

  async count(): Promise<number> {
    const result = await this.redis.scard(this.key);
    return result;
  }

  async clear(): Promise<void> {
    await (this.redis as any).unlink(this.key);
  }

  private async hasPipeline(batch: string[]): Promise<boolean[]> {
    const pipeline = this.redis.pipeline();

    batch.forEach((value) => pipeline.sismember(this.key, value));

    const response = await pipeline.exec() as [Nullable<Error>, 0 | 1][];

    const result = response.map(([error, result]) => {
      if (error) {
        throw error;
      }

      return result == 1;
    });

    return result;
  }

  private async popOne(): Promise<T> {
    const serialized = await this.redis.spop(this.key) as string;

    console.log('popOne response (function to be verified)', serialized);

    const result = this.deserialize(serialized);
    return result;
  }

  private async *popMany(count: number): AsyncIterableIterator<T> {
    const serialized = await this.redis.spop(this.key, count) as string[];
    const values = serialized.map(this.deserialize);

    yield* values;
  }
}
