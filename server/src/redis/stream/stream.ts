import { Redis } from 'ioredis';
import { AsyncDisposable } from '../../common/disposable';
import { SyncEnumerable } from '../../common/enumerable';
import { Nullable } from '../../common/utils';
import { Consumer } from './consumer';
import { ConsumerGroup } from './consumer-group';
import { Entry } from './entry';
import { PendingEntry } from './pending-entry';
import { PendingInfo, PendingInfoConsumer as PendingConsumerInfo } from './pending-info';
import { SourceEntry } from './source-entry';
import { StreamInfo } from './stream-info';

export type ReadParameters = {
  id: string,
  count?: number,
  block?: number
};

export type ReadGroupParameters = {
  id: string,
  group: string,
  consumer: string,
  count?: number,
  block?: number,
  noAck?: boolean
};

export type GetPendingInfoParameters = {
  group: string,
  consumer?: string,
};

export type GetPendingEntriesParameters = GetPendingInfoParameters & {
  start: string,
  end: string,
  count: number
};

export type ClaimParameters = {
  group: string,
  consumer: string,
  minimumIdleTime: number,
  ids: string[]
};

type EntryReturnValue = [string, string[]];

type EntriesReturnValue = EntryReturnValue[];

type ReadReturnValue = [string, EntriesReturnValue][];

type PendingReturnValue = [number, string, string, [string, string][]];

type InfoReturnValue = (string | number | EntryReturnValue)[];

export class RedisStream<T extends StringMap<string>> implements AsyncDisposable {
  private readonly redis: Redis;
  private readonly stream: string;
  private readonly quitRedisOnDispose: boolean;

  constructor(redis: Redis, stream: string, quitRedisOnDispose: boolean) {
    this.redis = redis;
    this.stream = stream;
    this.quitRedisOnDispose = quitRedisOnDispose;
  }

  async dispose(): Promise<void> {
    if (this.quitRedisOnDispose) {
      await this.redis.quit();
    }
  }

  async add(entry: SourceEntry<T>): Promise<string> {
    const { id: sourceId, data } = entry;
    const parameters = this.buildFieldValueArray(data);

    const id = await this.redis.xadd(this.stream, (sourceId != null) ? sourceId : '*', ...parameters) as string;
    return id;
  }

  async addMany(entries: SourceEntry<T>[]): Promise<string[]> {
    const transaction = this.redis.multi();

    for (const entry of entries) {
      const { id: sourceId, data } = entry;
      const parameters = this.buildFieldValueArray(data);

      transaction.xadd(this.stream, (sourceId != null) ? sourceId : '*', ...parameters);
    }

    const results = await transaction.exec() as [Nullable<Error>, string][];
    const ids = results.map(([, id]) => id);

    return ids;
  }

  async range(start: string, end: string): Promise<Entry<T>[]>;
  async range(start: string, end: string, count: number): Promise<Entry<T>[]>;
  async range(start: string, end: string, count?: number): Promise<Entry<T>[]> {
    const parameters = [this.stream, start, end, ...(count != null ? [count] : [])] as [string, string, string, number?];

    const range = this.redis.xrange(...parameters) as EntriesReturnValue;
    debugger;
    const entries = this.parseEntriesReturnValue(range);

    return entries;
  }

  async getMany(ids: string[]): Promise<Entry<T>[]> {
    if (ids.length == 0) {
      return [];
    }

    const pipeline = this.redis.pipeline();

    for (const id of ids) {
      pipeline.xrange(this.stream, id, id, 'COUNT', '1');
    }

    const result = await pipeline.exec() as [Nullable<Error>, EntriesReturnValue][];

    let entries: Entry<T>[] = [];

    for (const [error, value] of result) {
      if (error != null) {
        throw error;
      }

      const parsedEntries = this.parseEntriesReturnValue(value);
      entries = [...entries, ...parsedEntries];
    }

    return entries;
  }

  async deleteAddTransaction(deleteIds: string[], entries: SourceEntry<T>[]): Promise<string[]> {
    if (deleteIds.length == 0) {
      throw new Error('empty deleteIds array');
    }
    if (entries.length == 0) {
      throw new Error('empty entries array');
    }

    const transaction = this.redis.multi();

    transaction.xdel(this.stream, ...deleteIds);

    for (const entry of entries) {
      const { id: sourceId, data } = entry;
      const parameters = this.buildFieldValueArray(data);

      transaction.xadd(this.stream, (sourceId != null) ? sourceId : '*', ...parameters);
    }

    const results = await transaction.exec() as [[Nullable<Error>, number], ...[Nullable<Error>, string][]];
    const [deleteResult, ...addResults] = results;

    const ids = addResults.map(([, id]) => id);
    return ids;
  }

  async read({ id, block, count }: ReadParameters): Promise<Entry<T>[]> {
    const parametersArray = [
      ...(count != null ? ['COUNT', count] : []),
      ...(block != null ? ['BLOCK', block] : []),
      'STREAMS', this.stream,
      id
    ];

    const data = await this.redis.xread(...parametersArray) as ReadReturnValue;
    const entries = this.parseReadReturnValue(data);

    return entries;
  }

  async readGroup({ id, group, consumer, count, block, noAck }: ReadGroupParameters): Promise<Entry<T>[]> {
    const parametersArray = [
      'GROUP', group, consumer,
      ...(count != null ? ['COUNT', count] : []),
      ...(block != null ? ['BLOCK', block] : []),
      ...(noAck != null ? ['NOACK'] : []),
      'STREAMS', this.stream,
      id
    ] as ['GROUP', string, string, ...string[]];

    const data = await this.redis.xreadgroup(...parametersArray) as ReadReturnValue;
    const entries = this.parseReadReturnValue(data);

    return entries;
  }

  async delete(...ids: string[]): Promise<number> {
    const acknowledgedCount = await this.redis.xdel(this.stream, ...ids);
    return acknowledgedCount;
  }

  async acknowledge(group: string, ...ids: string[]): Promise<number> {
    const acknowledgedCount = await this.redis.xack(this.stream, group, ...ids);
    return acknowledgedCount;
  }

  async claim({ group, consumer, minimumIdleTime, ids }: ClaimParameters, idsOnly: false): Promise<Entry<T>[]>
  async claim({ group, consumer, minimumIdleTime, ids }: ClaimParameters, idsOnly: true): Promise<string[]>
  async claim({ group, consumer, minimumIdleTime, ids }: ClaimParameters, idsOnly: boolean): Promise<string[] | Entry<T>[]> {
    if (idsOnly) {
      const claimedIds = await this.redis.xclaim(this.stream, group, consumer, minimumIdleTime, ...ids, 'JUSTID') as string[];
      return claimedIds;
    }

    const claimedEntries = await this.redis.xclaim(this.stream, group, consumer, minimumIdleTime, ...ids) as EntriesReturnValue;
    debugger;
    const entries = this.parseEntriesReturnValue(claimedEntries);

    return entries;
  }

  async trim(maxLength: number, approximate: boolean): Promise<number> {
    const trimmedCount = await this.redis.xtrim(this.stream, 'MAXLEN', ...(approximate ? ['~'] : []), maxLength);
    return trimmedCount;
  }

  async info(): Promise<StreamInfo<T>> {
    const info = await this.redis.xinfo('STREAM', this.stream) as InfoReturnValue;
    const streamInfo = this.parseInfoReturnValue(info);

    return streamInfo;
  }

  async exists(): Promise<boolean> {
    const type = await this.redis.type(this.stream);
    return type == 'stream';
  }

  async hasGroup(name: string): Promise<boolean> {
    const exists = await this.exists();

    if (!exists) {
      return false;
    }

    const groups = await this.getGroups();
    return groups.some((group) => group.name == name);
  }

  async getGroups(): Promise<ConsumerGroup[]> {
    const info = await this.redis.xinfo('GROUPS', this.stream) as (string | number)[][];
    const groups = info.map((groupInfo) => this.parseGroupInfo(groupInfo));

    return groups;
  }

  async getConsumers(group: string): Promise<Consumer[]> {
    const info = await this.redis.xinfo('CONSUMERS', this.stream, group) as (string | number)[][];
    const consumers = info.map((consumerInfo) => this.parseConsumer(consumerInfo));

    return consumers;
  }

  async deleteConsumer(group: string, consumer: string): Promise<number> {
    const pendingMessages = await this.redis.xgroup('DELCONSUMER', this.stream, group, consumer);
    return pendingMessages;
  }

  async getPendingInfo(group: string): Promise<PendingInfo>;
  async getPendingInfo(group: string, consumer: string): Promise<PendingInfo>;
  async getPendingInfo(group: string, consumer?: string): Promise<PendingInfo> {
    const [count, firstId, lastId, pendingConsumerInfo] = await this.redis.xpending(this.stream, group, ...(consumer != null ? [consumer] : [])) as PendingReturnValue;
    const consumers: PendingConsumerInfo[] = pendingConsumerInfo.map(([name, count]) => ({ name, count: parseInt(count) }));
    const pendingInfo: PendingInfo = {
      count,
      firstId,
      lastId,
      consumers
    };

    return pendingInfo;
  }

  async getPendingEntries({ group, consumer, start, end, count }: GetPendingEntriesParameters): Promise<PendingEntry[]> {
    const info = await this.redis.xpending(this.stream, group, start, end, count, ...(consumer != null ? [consumer] : [])) as [string, string, number, number][];
    const pendingEntries: PendingEntry[] = info.map(([id, consumerName, elapsed, deliveryCount]) => ({ id, consumer: consumerName, elapsed, deliveryCount }));

    return pendingEntries;
  }

  async createGroup(group: string): Promise<void>;
  async createGroup(group: string, startAtId: '0' | '$' | string): Promise<void>;
  async createGroup(group: string, makeStream: boolean): Promise<void>;
  async createGroup(group: string, startAtId: '0' | '$' | string, makeStream: boolean): Promise<void>;
  async createGroup(group: string, startAtIdOrMakeStream?: '0' | '$' | string | boolean, makeStream: boolean = false): Promise<void> {
    const startAtId = (typeof startAtIdOrMakeStream == 'string') ? startAtIdOrMakeStream : '0';

    if (typeof startAtIdOrMakeStream == 'boolean') {
      makeStream = startAtIdOrMakeStream;
    }

    await this.redis.xgroup('CREATE', this.stream, group, startAtId, ...(makeStream ? ['MKSTREAM'] : []));
  }

  private buildFieldValueArray(data: StringMap<string>) {
    const parameters: string[] = [];
    const fields = Object.keys(data);

    for (const field of fields) {
      parameters.push(field, (data as StringMap<string>)[field]);
    }

    return parameters;
  }

  private parseReadReturnValue(data: ReadReturnValue): Entry<T>[] {
    const entries = SyncEnumerable.from(data)
      .mapMany(([_stream, entries]) => entries)
      .map((entry) => this.parseEntryReturnValue(entry))
      .toArray();

    return entries;
  }

  private parseInfoReturnValue(info: InfoReturnValue): StreamInfo<T> {
    const consumerGroup: StreamInfo<T> = {} as any;

    for (let i = 0; i < info.length; i += 2) {
      switch (info[i]) {
        case 'length':
          consumerGroup.length = info[i + 1] as number;
          break;

        case 'radix-tree-keys':
          consumerGroup.radixTreeKeys = info[i + 1] as number;
          break;

        case 'radix-tree-nodes':
          consumerGroup.radixTreeNodes = info[i + 1] as number;
          break;

        case 'groups':
          consumerGroup.groups = info[i + 1] as number;
          break;

        case 'first-entry':
          consumerGroup.firstEntry = this.parseEntryReturnValue(info[i + 1] as EntryReturnValue);
          break;

        case 'last-entry':
          consumerGroup.lastEntry = this.parseEntryReturnValue(info[i + 1] as EntryReturnValue);
          break;
      }
    }

    return consumerGroup;
  }

  private parseEntriesReturnValue(items: EntriesReturnValue): Entry<T>[] {
    const entries = items.map((item) => this.parseEntryReturnValue(item));
    return entries;
  }

  private parseEntryReturnValue([id, dataArray]: EntryReturnValue): Entry<T> {
    const entry: Entry<T> = { id, data: {} } as any;

    for (let i = 0; i < dataArray.length; i += 2) {
      const field = dataArray[i];
      const value = dataArray[i + 1];

      (entry.data as StringMap)[field] = value;
    }

    return entry;
  }

  private parseGroupInfo(info: (string | number)[]): ConsumerGroup {
    const consumerGroup: ConsumerGroup = {} as any;

    for (let i = 0; i < info.length; i += 2) {
      switch (info[i]) {
        case 'name':
          consumerGroup.name = info[i + 1] as string;
          break;

        case 'consumers':
          consumerGroup.consumers = info[i + 1] as number;
          break;

        case 'pending':
          consumerGroup.pending = info[i + 1] as number;
          break;
      }
    }

    return consumerGroup;
  }

  private parseConsumer(info: (string | number)[]): Consumer {
    const consumer: Consumer = {} as any;

    for (let i = 0; i < info.length; i += 2) {
      switch (info[i]) {
        case 'name':
          consumer.name = info[i + 1] as string;
          break;

        case 'pending':
          consumer.pending = info[i + 1] as number;
          break;

        case 'idle':
          consumer.idle = info[i + 1] as number;
          break;
      }
    }

    return consumer;
  }
}
