import { Client as ElasticsearchClient } from 'elasticsearch';
import * as Redis from 'ioredis';
import * as Mongo from 'mongodb';

import { LockProvider } from './common/lock';
import { Logger, LoggerFactory } from './common/logger';
import { AggregatedEntry } from './common/model';
import { SearchEngine } from './common/search-engine';
import config from './config';
import { DatastoreFactory } from './datastore';
import { RedisDatastoreFactory } from './datastore/redis';
import { DistributedLoopProvider } from './distributed-loop';
import { ElasticsearchMapping, ElasticsearchSettings, TextTypeFields } from './elasticsearch-definitions';
import { EntriesImporter } from './entries-importer/importer';
import { Filmlist } from './entry-source/filmlist/filmlist';
import { FilmlistEntrySource } from './entry-source/filmlist/filmlist-entry-source';
import { FilmlistManager } from './entry-source/filmlist/filmlist-manager';
import { FilmlistRepository, MediathekViewWebVerteilerFilmlistRepository } from './entry-source/filmlist/repository';
import { RedisLockProvider } from './lock/redis';
import { LoggerFactoryProvider } from './logger-factory-provider';
import { QueueProvider } from './queue';
import { BullQueueProvider } from './queue/bull/provider';
import { AggregatedEntryRepository, EntryRepository } from './repository';
import { MongoEntryRepository } from './repository/mongo/entry-repository';
import { NonWorkingAggregatedEntryRepository } from './repository/non-working-aggregated-entry-repository';
import { ElasticsearchSearchEngine } from './search-engine/elasticsearch';
import { Converter } from './search-engine/elasticsearch/converter';
import * as ConvertHandlers from './search-engine/elasticsearch/converter/handlers';
import { Serializer } from './serializer';


const MEDIATHEKVIEWWEB_VERTEILER_URL = 'https://verteiler.mediathekviewweb.de/';

const MONGO_CONNECTION_STRING = 'mongodb://localhost:27017';
const MONGO_DATABASE_NAME = 'mediathekviewweb';
const MONGO_ENTRIES_COLLECTION_NAME = 'entries';

const ELASTICSEARCH_INDEX_NAME = 'mediathekviewweb';
const ELASTICSEARCH_TYPE_NAME = 'entry';
const ELASTICSEARCH_INDEX_SETTINGS = ElasticsearchSettings;
const ELASTICSEARCH_INDEX_MAPPING = ElasticsearchMapping;

const CORE_LOG = '[CORE]';
const FILMLIST_MANAGER_LOG = '[FILMLIST_MANAGER]';
const QUEUE_LOG = '[QUEUE]';
const ENTRIES_IMPORTER_LOG = '[IMPORTER]';
const FILMLIST_ENTRY_SOURCE = '[FILMLIST_SOURCE]';
const SEARCH_ENGINE_LOG = '[SEARCH_ENGINE]';

export class InstanceProvider {
  private static instances: StringMap = {};
  private static loggerFactory: LoggerFactory = LoggerFactoryProvider.factory;

  static appLogger(): Promise<Logger> {
    return this.singleton('appLogger', () => this.loggerFactory.create(CORE_LOG));
  }

  static serializer(): Promise<Serializer> {
    return this.singleton(Serializer, () => {
      const serializer = new Serializer();
      serializer.registerPrototype(Filmlist);

      return serializer;
    });
  }

  static redis(): Promise<Redis.Redis> {
    return this.singleton(Redis, () => new Redis(config.redis));
  }

  static elasticsearch(): Promise<ElasticsearchClient> {
    return this.singleton(ElasticsearchClient, () => new ElasticsearchClient({}));
  }

  static mongo(): Promise<Mongo.MongoClient> {
    return this.singleton(Mongo.MongoClient, () => Mongo.MongoClient.connect(MONGO_CONNECTION_STRING));
  }

  static database(): Promise<Mongo.Db> {
    return this.singleton(Mongo.Db, async () => {
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
    return this.singleton(RedisDatastoreFactory, async () => {
      const redis = await this.redis();
      return new RedisDatastoreFactory(redis);
    });
  }

  static lockProvider(): Promise<LockProvider> {
    return this.singleton(RedisLockProvider, async () => {
      const redis = await this.redis();
      return new RedisLockProvider(redis);
    });
  }

  static filmlistRepository(): Promise<FilmlistRepository> {
    return this.singleton(MediathekViewWebVerteilerFilmlistRepository, () => new MediathekViewWebVerteilerFilmlistRepository(MEDIATHEKVIEWWEB_VERTEILER_URL));
  }

  static distributedLoopProvider(): Promise<DistributedLoopProvider> {
    return this.singleton(DistributedLoopProvider, async () => {
      const lockProvider = await this.lockProvider();
      return new DistributedLoopProvider(lockProvider);
    });
  }

  static queueProvider(): Promise<QueueProvider> {
    return this.singleton(BullQueueProvider, async () => {
      const serializer = await this.serializer();
      const queue = new BullQueueProvider(serializer, this.loggerFactory, QUEUE_LOG);

      return queue;
    });
  }

  static entriesImporter(): Promise<EntriesImporter> {
    return this.singleton(EntriesImporter, async () => {
      const datastoreFactory = await this.datastoreFactory();
      const entryRepository = await this.entryRepository();
      const logger = LoggerFactoryProvider.factory.create(ENTRIES_IMPORTER_LOG);

      return new EntriesImporter(entryRepository, datastoreFactory, logger);
    });
  }

  static entryRepository(): Promise<EntryRepository> {
    return this.singleton(MongoEntryRepository, async () => {
      const collection = await this.entriesCollection();
      return new MongoEntryRepository(collection);
    });
  }

  static aggregatedEntryRepository(): Promise<AggregatedEntryRepository> {
    return this.singleton(NonWorkingAggregatedEntryRepository, async () => {
      const entryRepository = await this.entryRepository();
      return new NonWorkingAggregatedEntryRepository(entryRepository);
    });
  }

  static entrySearchEngine(): Promise<SearchEngine<AggregatedEntry>> {
    return this.singleton(ElasticsearchSearchEngine, async () => {
      const elasticsearch = await this.elasticsearch();
      const converter = await this.elasticsearchConverter();
      const logger = LoggerFactoryProvider.factory.create(SEARCH_ENGINE_LOG);

      const elasticsearchSearchEngine = new ElasticsearchSearchEngine<AggregatedEntry>(elasticsearch, converter, ELASTICSEARCH_INDEX_NAME, ELASTICSEARCH_TYPE_NAME, logger, ELASTICSEARCH_INDEX_SETTINGS, ELASTICSEARCH_INDEX_MAPPING);
      await elasticsearchSearchEngine.initialize();

      return elasticsearchSearchEngine;
    });
  }

  static elasticsearchConverter(): Promise<Converter> {
    return this.singleton(Converter, () => {
      const keywordRewrites = new Set(TextTypeFields);
      const sortConverter = new ConvertHandlers.SortConverter(keywordRewrites);
      const converter = new Converter(sortConverter);

      converter.registerHandler(
        new ConvertHandlers.TextQueryConvertHandler(),
        new ConvertHandlers.IDsQueryConvertHandler(),
        new ConvertHandlers.MatchAllQueryConvertHandler(),
        new ConvertHandlers.RegexQueryConvertHandler(),
        new ConvertHandlers.TermQueryConvertHandler(),
        new ConvertHandlers.BoolQueryConvertHandler(converter),
        new ConvertHandlers.RangeQueryConvertHandler()
      );

      return converter;
    });
  }

  static filmlistEntrySource(): Promise<FilmlistEntrySource> {
    return this.singleton(FilmlistEntrySource, async () => {
      const datastoreFactory = await this.datastoreFactory();
      const queueProvider = await this.queueProvider();
      const logger = this.loggerFactory.create(FILMLIST_ENTRY_SOURCE);

      return new FilmlistEntrySource(datastoreFactory, queueProvider, logger);
    });
  }

  static filmlistManager(): Promise<FilmlistManager> {
    return this.singleton(FilmlistManager, async () => {
      const datastoreFactory = await this.datastoreFactory();
      const filmlistRepository = await this.filmlistRepository();
      const distributedLoopProvider = await this.distributedLoopProvider();
      const queueProvider = await this.queueProvider();
      const logger = this.loggerFactory.create(FILMLIST_MANAGER_LOG);

      return new FilmlistManager(datastoreFactory, filmlistRepository, distributedLoopProvider, queueProvider, logger);
    });
  }

  private static async singleton<T>(type: any, builder: () => T | Promise<T>): Promise<T> {
    if (this.instances[type] == undefined) {
      const instance = await builder();
      this.instances[type] = instance;
    }

    return this.instances[type];
  }
}
