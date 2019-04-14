import { AggregatedEntry, Entry } from '../common/model';
import { EntryRepository } from '../repositories/entry-repository';
import { AggregatedEntryDataSource } from './aggregated-entry.data-source';

export class NonWorkingAggregatedEntryDataSource implements AggregatedEntryDataSource {
  private readonly entryRepository: EntryRepository;

  constructor(entryRepository: EntryRepository) {
    this.entryRepository = entryRepository;
  }

  async load(id: string): Promise<AggregatedEntry | undefined> {
    let result: AggregatedEntry | undefined;

    const entry = await this.entryRepository.load(id);

    if (entry != undefined) {
      result = this.toAggregated(entry);
    }

    return result;
  }

  async loadMany(ids: string[]): Promise<AggregatedEntry[]> {
    const entryDocuments = await this.entryRepository.loadMany(ids);
    const result = entryDocuments.map((entryDocument) => this.toAggregated(entryDocument));

    return result;
  }

  private toAggregated(entry: Entry): AggregatedEntry {
    const aggregatedEntry = {
      ...entry,
      date: this.getDateTimestamp(entry.timestamp),
      time: this.getTime(entry.timestamp),

      metadata: {
        downloads: 1234,
        plays: 1234,
        comments: 0,
        averageRating: 2.5,
        secondsPlayed: 1234,
        secondsPaused: 1234
      }
    };

    return aggregatedEntry;
  }

  private getDateTimestamp(timestamp: number): number {
    const date = new Date(timestamp * 1000);
    const dateWithoutTime = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

    return Math.floor(dateWithoutTime.valueOf() / 1000);
  }

  private getTime(timestamp: number): number {
    return timestamp % 86400000;
  }
}
