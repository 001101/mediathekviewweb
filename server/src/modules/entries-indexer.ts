
import { AsyncDisposer, disposeAsync } from '@common-ts/base/disposable';
import { AsyncEnumerable } from '@common-ts/base/enumerable';
import { Logger } from '@common-ts/base/logger';
import { Job, Queue, QueueProvider } from '@common-ts/base/queue';
import { timeout } from '@common-ts/base/utils';
import { CancellationToken } from '@common-ts/base/utils/cancellation-token';
import { Module, ModuleBase, ModuleMetric } from '@common-ts/server/module';
import { AggregatedEntry } from '../common/model';
import { SearchEngine } from '../common/search-engine';
import { AggregatedEntryDataSource } from '../data-sources/aggregated-entry.data-source';
import { keys } from '../keys';

const BATCH_SIZE = 100;

export class EntriesIndexerModule extends ModuleBase implements Module {
  private readonly aggregatedEntryDataSource: AggregatedEntryDataSource;
  private readonly searchEngine: SearchEngine<AggregatedEntry>;
  private readonly queueProvider: QueueProvider;
  private readonly logger: Logger;

  constructor(aggregatedEntryDataSource: AggregatedEntryDataSource, searchEngine: SearchEngine<AggregatedEntry>, queueProvider: QueueProvider, logger: Logger) {
    super('EntriesIndexer');

    this.aggregatedEntryDataSource = aggregatedEntryDataSource;
    this.searchEngine = searchEngine;
    this.queueProvider = queueProvider;
    this.logger = logger;
  }

  getMetrics(): ModuleMetric[] {
    return [];
  }

  protected async _run(_cancellationToken: CancellationToken): Promise<void> {
    const disposer = new AsyncDisposer();
    const entriesToBeIndexedQueue = this.queueProvider.get<string>(keys.EntriesToBeIndexed, 15000);

    const consumer = entriesToBeIndexedQueue.getBatchConsumer(BATCH_SIZE, this.cancellationToken);

    await AsyncEnumerable.from(consumer)
      .forEach(async (batch) => {
        try {
          await this.indexBatch(batch);
          await entriesToBeIndexedQueue.acknowledge(batch);
        }
        catch (error) {
          this.logger.error(error as Error);
          await timeout(2500);
        }
      });

    await disposer[disposeAsync]();
  }

  private async indexBatch(batch: Job<string>[]): Promise<void> {
    const ids = batch.map((job) => job.data);
    await this.indexEntries(ids);
  }

  private async indexEntries(ids: string[]): Promise<void> {
    const entries = await this.aggregatedEntryDataSource.loadMany(ids);
    const searchEngineItems = entries.map((entry) => ({ id: entry.id, document: entry }));

    await this.searchEngine.index(searchEngineItems);
  }
}
