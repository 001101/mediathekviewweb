import { AsyncDisposer } from '@common-ts/base/disposable';
import { LockProvider } from '@common-ts/base/lock';
import { Logger } from '@common-ts/base/logger';
import { ConsoleLogger } from '@common-ts/base/logger/console';
import { singleton, timeout } from '@common-ts/base/utils';
import { MongoDocument } from '@common-ts/mongo';
import { DistributedLoopProvider } from '@common-ts/server/distributed-loop';
import { Client as ElasticsearchClient } from 'elasticsearch';
import * as RedisClient from 'ioredis';
import { Redis } from 'ioredis'; // tslint:disable-line: no-duplicate-imports
import * as Mongo from 'mongodb';
import { AggregatedEntry, Entry } from './common/model';
import { SearchEngine } from './common/search-engine';
import { config } from './config';
import { AggregatedEntryDataSource } from './data-sources/aggregated-entry.data-source';
import { NonWorkingAggregatedEntryDataSource } from './data-sources/non-working-aggregated-entry.data-source';
import { DatastoreFactory } from './datastore';
import { RedisDatastoreFactory } from './datastore/redis';
import { elasticsearchMapping, elasticsearchSettings, textTypeFields } from './elasticsearch-definitions';
import { FilmlistEntrySource } from './entry-source/filmlist/filmlist-entry-source';
import { FilmlistRepository, MediathekViewWebVerteilerFilmlistRepository } from './entry-source/filmlist/repository';
import { RedisLockProvider } from './lock/redis';
import { FilmlistImport } from './model/filmlist-import';
import { ApiModule } from './modules/api';
import { EntriesImporterModule } from './modules/entries-importer';
import { EntriesIndexerModule } from './modules/entries-indexer';
import { EntriesSaverModule } from './modules/entries-saver';
import { FilmlistManagerModule } from './modules/filmlist-manager';
import { QueueProvider } from './queue';
import { RedisQueueProvider } from './queue/redis';
import { RedisProvider } from './redis/provider';
import { EntryRepository } from './repositories';
import { FilmlistImportRepository } from './repositories/filmlists-import-repository';
import { MongoEntryRepository } from './repositories/mongo/entry-repository';
import { MongoFilmlistImportRepository } from './repositories/mongo/filmlist-import-repository';
import { ElasticsearchSearchEngine } from './search-engine/elasticsearch';
import { Converter } from './search-engine/elasticsearch/converter';
import * as ConvertHandlers from './search-engine/elasticsearch/converter/handlers';
import { getElasticsearchLogAdapter } from './utils/elasticsearch-log-adapter-factory';
import { getMongoLogAdapter } from './utils/mongo-log-adapter-factory';

const MEDIATHEKVIEWWEB_VERTEILER_URL = 'https://verteiler.mediathekviewweb.de/';

const MONGO_CONNECTION_STRING = 'mongodb://localhost:27017';
const MONGO_CLIENT_OPTIONS: Mongo.MongoClientOptions = { appname: 'MediathekViewWeb', useNewUrlParser: true, autoReconnect: true, reconnectTries: Number.POSITIVE_INFINITY };
const MONGO_DATABASE_NAME = 'mediathekviewweb';
const MONGO_ENTRIES_COLLECTION_NAME = 'entries';
const FILMLIST_IMPORTS_COLLECTION_NAME = 'filmlistImports';

const ELASTICSEARCH_INDEX_NAME = 'mediathekviewweb';
const ELASTICSEARCH_TYPE_NAME = 'entry';
const ELASTICSEARCH_INDEX_SETTINGS = elasticsearchSettings;
const ELASTICSEARCH_INDEX_MAPPING = elasticsearchMapping;

const CORE_LOG = 'CORE';
const QUEUE_LOG = 'QUEUE';
const LOCK_LOG = 'LOCK';
const DISTRIBUTED_LOOP_LOG = 'LOOP';
const FILMLIST_ENTRY_SOURCE = 'FILMLIST SOURCE';
const SEARCH_ENGINE_LOG = 'SEARCH ENGINE';
const ELASTICSEARCH_LOG = 'ELASTICSEARCH';
const REDIS_LOG = 'REDIS';
const MONGO_LOG = 'MONGO';
const REST_API_LOG = 'REST API';

const FILMLIST_MANAGER_MODULE_LOG = 'FILMLIST MANAGER';
const ENTRIES_IMPORTER_MODULE_LOG = 'IMPORTER';
const ENTRIES_SAVER_MODULE_LOG = 'SAVER';
const ENTRIES_INDEXER_MODULE_LOG = 'INDEXER';
const API_MODULE_LOG = 'API';

function getRedisProvider(providerFunction: (scope: string) => Promise<Redis>): RedisProvider {
  return {
    get: providerFunction
  };
}

export class InstanceProvider {
  private static readonly disposer: AsyncDisposer = new AsyncDisposer();

  private static loggerInstance(): Logger {
    return singleton(ConsoleLogger, () => {
      const logger = new ConsoleLogger(config.verbosity);
      return logger;
    });
  }

  private static async connect(name: string, connectFunction: (() => Promise<any>), logger: Logger): Promise<void> {
    let success = false;
    while (!success && !InstanceProvider.disposer.disposing) {
      try {
        logger.verbose(`connecting to ${name}...`);
        await connectFunction();
        success = true;
        logger.info(`connected to ${name}`);
      }
      catch (error) {
        logger.verbose(`error connecting to ${name} (${(error as Error).message}), trying again...`);
        await timeout(2000);
      }
    }
  }

  private static async newRedis(scope: string): Promise<Redis> {
    const logger = InstanceProvider.logger(`[${REDIS_LOG}] [${scope}] `, false);

    const redis = new RedisClient({
      lazyConnect: true,
      enableReadyCheck: true,
      maxRetriesPerRequest: undefined,
      ...config.redis
    });

    redis
      .on('connect', () => logger.verbose('connecting'))
      .on('ready', () => logger.verbose('ready'))
      .on('close', () => logger.verbose('connection closing'))
      .on('reconnecting', (milliseconds) => logger.verbose(`reconnecting in ${milliseconds} ms`))
      .on('end', () => logger.verbose('connection end'))
      .on('error', (error: Error) => logger.error(error, false));

    InstanceProvider.disposer.addDisposeTasks(async () => {
      const endPromise = new Promise<void>((resolve) => redis.once('end', resolve));

      await redis.quit();
      await endPromise;
    });

    await InstanceProvider.connect('redis', async () => await redis.connect() as Promise<void>, logger);

    return redis;
  }

  static async disposeInstances(): Promise<void> {
    InstanceProvider.coreLogger().debug('dispose instances');
    await InstanceProvider.disposer.dispose();
  }

  static logger(prefix: string, autoBrackets: boolean = true): Logger {
    const formattedPrefix = autoBrackets ? `[${prefix}] ` : prefix;
    const logger = InstanceProvider.loggerInstance().prefix(formattedPrefix);

    return logger;
  }

  static async entriesSaverModule(): Promise<EntriesSaverModule> {
    return singleton(EntriesSaverModule, async () => {
      const entryRepository = await InstanceProvider.entryRepository();
      const queueProvider = await InstanceProvider.queueProvider();
      const logger = InstanceProvider.logger(ENTRIES_SAVER_MODULE_LOG);

      return new EntriesSaverModule(entryRepository, queueProvider, logger);
    });
  }

  static async entriesIndexerModule(): Promise<EntriesIndexerModule> {
    return singleton(EntriesIndexerModule, async () => {
      const aggregatedEntryDataSource = await InstanceProvider.aggregatedEntryDataSource();
      const searchEngine = await InstanceProvider.entrySearchEngine();
      const queueProvider = await InstanceProvider.queueProvider();
      const logger = InstanceProvider.logger(ENTRIES_INDEXER_MODULE_LOG);

      return new EntriesIndexerModule(aggregatedEntryDataSource, searchEngine, queueProvider, logger);
    });
  }

  static async apiModule(): Promise<ApiModule> {
    throw new Error('not implemented');
    /* return singleton(ApiModule, async () => {
     const restApi = await InstanceProvider.restApi();
     const logger = InstanceProvider.logger(API_MODULE_LOG);

     return new ApiModule(restApi, logger);
   }); */
  }

  static coreLogger(): Logger {
    return singleton('coreLogger', () => {
      const logger = InstanceProvider.logger(CORE_LOG);
      return logger;
    });
  }

  static redisProvider(): RedisProvider {
    return singleton(getRedisProvider, () => getRedisProvider(async (scope) => InstanceProvider.newRedis(scope)));
  }

  static async redis(): Promise<Redis> {
    return singleton(RedisClient, async () => InstanceProvider.newRedis('MAIN'));
  }

  static async elasticsearch(): Promise<ElasticsearchClient> {
    return singleton(ElasticsearchClient, async () => {
      const logger = InstanceProvider.logger(ELASTICSEARCH_LOG);
      const logAdapter = getElasticsearchLogAdapter(logger);

      const elasticsearchClient = new ElasticsearchClient({
        host: `${config.elasticsearch.host}:${config.elasticsearch.port}`,
        log: logAdapter
      });

      InstanceProvider.disposer.addDisposeTasks(() => elasticsearchClient.close());

      await InstanceProvider.connect('elasticsearch', async () => await elasticsearchClient.ping({ requestTimeout: 500 }) as Promise<void>, logger);

      return elasticsearchClient;
    });
  }

  static async mongo(): Promise<Mongo.MongoClient> {
    return singleton(Mongo.MongoClient, async () => {
      const logger = InstanceProvider.logger(MONGO_LOG);
      const logFunction = getMongoLogAdapter(logger);

      Mongo.Logger.setCurrentLogger(logFunction);

      const mongoClient: Mongo.MongoClient = new Mongo.MongoClient(MONGO_CONNECTION_STRING, MONGO_CLIENT_OPTIONS);

      mongoClient
        .on('fullsetup', () => logger.verbose('connection setup'))
        .on('reconnect', () => logger.warn('reconnected'))
        .on('timeout', () => logger.warn('connection timed out'))
        .on('close', () => logger.verbose('connection closed'));

      InstanceProvider.disposer.addDisposeTasks(async () => await mongoClient.close());

      await InstanceProvider.connect('mongo', async () => await mongoClient.connect(), logger);

      return mongoClient;
    });
  }

  static async database(): Promise<Mongo.Db> {
    return singleton(Mongo.Db, async () => {
      const mongo = await InstanceProvider.mongo();
      return mongo.db(MONGO_DATABASE_NAME);
    });
  }

  static async entriesCollection(): Promise<Mongo.Collection<MongoDocument<Entry>>> {
    return InstanceProvider.collection(MONGO_ENTRIES_COLLECTION_NAME);
  }

  static async filmlistImportCollection(): Promise<Mongo.Collection<MongoDocument<FilmlistImport>>> {
    return InstanceProvider.collection(FILMLIST_IMPORTS_COLLECTION_NAME);
  }

  static async collection(name: string): Promise<Mongo.Collection> {
    return singleton(`mongo-collection-${name}`, async () => {
      const database = await InstanceProvider.database();
      return database.collection(name);
    });
  }

  static async datastoreFactory(): Promise<DatastoreFactory> {
    return singleton(RedisDatastoreFactory, async () => {
      const redis = await InstanceProvider.redis();
      return new RedisDatastoreFactory(redis);
    });
  }

  static async lockProvider(): Promise<LockProvider> {
    return singleton(RedisLockProvider, async () => {
      const redis = await InstanceProvider.redis();
      const logger = InstanceProvider.logger(LOCK_LOG);

      return new RedisLockProvider(redis, logger);
    });
  }

  static filmlistRepository(): FilmlistRepository {
    return singleton(MediathekViewWebVerteilerFilmlistRepository, () => new MediathekViewWebVerteilerFilmlistRepository(MEDIATHEKVIEWWEB_VERTEILER_URL));
  }

  static async distributedLoopProvider(): Promise<DistributedLoopProvider> {
    return singleton(DistributedLoopProvider, async () => {
      const lockProvider = await InstanceProvider.lockProvider();
      return new DistributedLoopProvider(lockProvider);
    });
  }

  static async queueProvider(): Promise<QueueProvider> {
    return singleton(RedisQueueProvider, async () => {
      const redis = await InstanceProvider.redis();
      const redisProvider = InstanceProvider.redisProvider();
      const lockProvider = await InstanceProvider.lockProvider();
      const distributedLoopProvider = await InstanceProvider.distributedLoopProvider();
      const logger = InstanceProvider.logger(QUEUE_LOG);

      const queue = new RedisQueueProvider(redis, redisProvider, lockProvider, distributedLoopProvider, logger);
      return queue;
    });
  }

  static async entriesImporterModule(): Promise<EntriesImporterModule> {
    return singleton(EntriesImporterModule, async () => {
      const queueProvider = await InstanceProvider.queueProvider();
      const logger = InstanceProvider.logger(ENTRIES_IMPORTER_MODULE_LOG);
      const source = await InstanceProvider.filmlistEntrySource();

      return new EntriesImporterModule(queueProvider, logger, [source]);
    });
  }

  static async entryRepository(): Promise<EntryRepository> {
    return singleton(MongoEntryRepository, async () => {
      const collection = await InstanceProvider.entriesCollection();
      const repository = new MongoEntryRepository(collection);

      await repository.initialize();

      return repository;
    });
  }

  static async filmlistImportRepository(): Promise<FilmlistImportRepository> {
    return singleton(MongoFilmlistImportRepository, async () => {
      const collection = await InstanceProvider.filmlistImportCollection();
      return new MongoFilmlistImportRepository(collection);
    });
  }

  static async aggregatedEntryDataSource(): Promise<AggregatedEntryDataSource> {
    return singleton(NonWorkingAggregatedEntryDataSource, async () => {
      const entryRepository = await InstanceProvider.entryRepository();
      return new NonWorkingAggregatedEntryDataSource(entryRepository);
    });
  }

  static async entrySearchEngine(): Promise<SearchEngine<AggregatedEntry>> {
    return singleton(ElasticsearchSearchEngine, async () => {
      const elasticsearch = await InstanceProvider.elasticsearch();
      const converter = InstanceProvider.elasticsearchConverter();
      const lockProvider = await InstanceProvider.lockProvider();
      const logger = InstanceProvider.logger(SEARCH_ENGINE_LOG);

      const elasticsearchSearchEngine = new ElasticsearchSearchEngine<AggregatedEntry>(elasticsearch, converter, ELASTICSEARCH_INDEX_NAME, ELASTICSEARCH_TYPE_NAME, lockProvider, logger, ELASTICSEARCH_INDEX_SETTINGS, ELASTICSEARCH_INDEX_MAPPING);

      InstanceProvider.disposer.addDisposeTasks(async () => await elasticsearchSearchEngine.dispose());

      await elasticsearchSearchEngine.initialize();

      return elasticsearchSearchEngine;
    });
  }

  static elasticsearchConverter(): Converter {
    return singleton(Converter, () => {
      const keywordRewrites = new Set(textTypeFields);
      const sortConverter = new ConvertHandlers.SortConverter(keywordRewrites);
      const converter = new Converter(sortConverter);

      converter.registerHandler(
        new ConvertHandlers.TextQueryConvertHandler(),
        new ConvertHandlers.IdsQueryConvertHandler(),
        new ConvertHandlers.MatchAllQueryConvertHandler(),
        new ConvertHandlers.RegexQueryConvertHandler(),
        new ConvertHandlers.TermQueryConvertHandler(),
        new ConvertHandlers.BoolQueryConvertHandler(converter),
        new ConvertHandlers.RangeQueryConvertHandler()
      );

      return converter;
    });
  }

  static async filmlistEntrySource(): Promise<FilmlistEntrySource> {
    return singleton(FilmlistEntrySource, async () => {
      const filmlistImportRepository = await InstanceProvider.filmlistImportRepository();
      const queueProvider = await InstanceProvider.queueProvider();
      const logger = InstanceProvider.logger(FILMLIST_ENTRY_SOURCE);

      return new FilmlistEntrySource(filmlistImportRepository, queueProvider, logger);
    });
  }

  static async filmlistManagerModule(): Promise<FilmlistManagerModule> {
    return singleton(FilmlistManagerModule, async () => {
      const datastoreFactory = await InstanceProvider.datastoreFactory();
      const filmlistImportRepository = await InstanceProvider.filmlistImportRepository();
      const filmlistRepository = InstanceProvider.filmlistRepository();
      const distributedLoopProvider = await InstanceProvider.distributedLoopProvider();
      const queueProvider = await InstanceProvider.queueProvider();
      const logger = InstanceProvider.logger(FILMLIST_MANAGER_MODULE_LOG);

      return new FilmlistManagerModule(datastoreFactory, filmlistImportRepository, filmlistRepository, distributedLoopProvider, queueProvider, logger);
    });
  }
}
