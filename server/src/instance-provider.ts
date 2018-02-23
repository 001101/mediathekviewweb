import * as Elasticsearch from 'elasticsearch';
import * as Redis from 'ioredis';
import * as Mongo from 'mongodb';

import { LockProvider } from './common/lock';
import { LoggerFactory, LogLevel } from './common/logger';
import { ConsoleLoggerFactory } from './common/logger/console';
import { AggregatedEntry } from './common/model';
import { SearchEngine } from './common/search-engine';
import { DatastoreFactory } from './datastore';
import { RedisDatastoreFactory } from './datastore/redis';
import { DistributedLoopProvider } from './distributed-loop';
import { ElasticsearchMapping, ElasticsearchSettings } from './elasticsearch-definitions';
import { FilmlistManager } from './entry-source/filmlist/filmlist-manager';
import { FilmlistRepository, MediathekViewWebVerteilerFilmlistRepository } from './entry-source/filmlist/repository';
import { RedisLockProvider } from './lock/redis';
import { QueueProvider } from './queue';
import { BullQueueProvider } from './queue/bull/provider';
import { AggregatedEntryRepository, EntryRepository } from './repository';
import { MongoEntryRepository } from './repository/mongo/entry-repository';
import { NonWorkingAggregatedEntryRepository } from './repository/non-working-aggregated-entry-repository';
import { ElasticsearchSearchEngine } from './search-engine/elasticsearch';

const MONGO_CONNECTION_STRING = 'mongodb://localhost:27017';
const MONGO_DATABASE_NAME = 'mediathekviewweb';
const MONGO_ENTRIES_COLLECTION_NAME = 'entries';
const MEDIATHEKVIEWWEB_VERTEILER_URL = 'https://verteiler.mediathekviewweb.de/';
const ELASTICSEARCH_INDEX_NAME = 'mediathekviewweb';
const ELASTICSEARCH_TYPE_NAME = 'entry';
const ELASTICSEARCH_INDEX_SETTINGS = ElasticsearchSettings;
const ELASTICSEARCH_INDEX_MAPPING = ElasticsearchMapping;

export class InstanceProvider {
  private static instances: ObjectMap<any> = {};

  static redis(): Promise<Redis.Redis> {
    return this.singleton('redis', () => new Redis());
  }

  static elasticsearch(): Promise<Elasticsearch.Client> {
    return this.singleton('elasticsearch', () => new Elasticsearch.Client({}));
  }

  static mongo(): Promise<Mongo.MongoClient> {
    return this.singleton('mongo', () => Mongo.MongoClient.connect(MONGO_CONNECTION_STRING));
  }

  static database(): Promise<Mongo.Db> {
    return this.singleton('database', async () => {
      const mongo = await this.mongo();
      return mongo.db(MONGO_DATABASE_NAME);
    });
  }

  static entriesCollection(): Promise<Mongo.Collection> {
    return this.singleton('entriesCollection', async () => {
      const database = await this.database();
      return database.collection(MONGO_ENTRIES_COLLECTION_NAME);
    });
  }

  static datastoreFactory(): Promise<DatastoreFactory> {
    return this.singleton('datastoreFactory', async () => {
      const redis = await this.redis();
      return new RedisDatastoreFactory(redis);
    });
  }

  static lockProvider(): Promise<LockProvider> {
    return this.singleton('lockProvider', async () => {
      const redis = await this.redis();
      return new RedisLockProvider(redis);
    });
  }

  static filmlistRepository(): Promise<FilmlistRepository> {
    return this.singleton('filmlistRepository', async () => {
      return new MediathekViewWebVerteilerFilmlistRepository(MEDIATHEKVIEWWEB_VERTEILER_URL);
    });
  }

  static distributedLoopProvider(): Promise<DistributedLoopProvider> {
    return this.singleton('distributedLoopProvider', async () => {
      const lockProvider = await this.lockProvider();
      return new DistributedLoopProvider(lockProvider);
    });
  }

  static queueProvider(): Promise<QueueProvider> {
    return this.singleton('queueProvider', () => new BullQueueProvider());
  }

  static entryRepository(): Promise<EntryRepository> {
    return this.singleton('entryRepository', async () => {
      const collection = await this.entriesCollection();
      return new MongoEntryRepository(collection);
    });
  }

  static aggregatedEntryRepository(): Promise<AggregatedEntryRepository> {
    return this.singleton('aggregatedEntryRepository', async () => {
      const entryRepository = await this.entryRepository();
      return new NonWorkingAggregatedEntryRepository(entryRepository);
    });
  }

  static entrySearchEngine(): Promise<SearchEngine<AggregatedEntry>> {
    return this.singleton('entrySearchEngine', async () => {
      const elasticsearch = await this.elasticsearch();
      const elasticsearchSearchEngine = new ElasticsearchSearchEngine<AggregatedEntry>(elasticsearch,
        ELASTICSEARCH_INDEX_NAME, ELASTICSEARCH_TYPE_NAME, ELASTICSEARCH_INDEX_SETTINGS, ELASTICSEARCH_INDEX_MAPPING);

      await elasticsearchSearchEngine.initialize();

      return elasticsearchSearchEngine;
    });
  }

  static filmlistManager(): Promise<FilmlistManager> {
    return this.singleton('filmlistManager', async () => {
      const datastoreFactory = await this.datastoreFactory();
      const filmlistRepository = await this.filmlistRepository();
      const distributedLoopProvider = await this.distributedLoopProvider();
      const queueProvider = await this.queueProvider();

      return new FilmlistManager(datastoreFactory, filmlistRepository, distributedLoopProvider, queueProvider);
    });
  }

  private static async singleton<T>(type: string, builder: () => T | Promise<T>): Promise<T> {
    if (this.instances[type] == undefined) {
      this.instances[type] = await builder();
    }

    return this.instances[type];
  }
}