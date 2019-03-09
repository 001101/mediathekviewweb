import { Entry } from '../common/model';

export interface EntryRepository {
  save(entry: Entry): Promise<void>;
  saveMany(entries: Entry[]): Promise<void>;

  load(id: string): Promise<Entry | undefined>;
  loadMany(ids: string[]): AsyncIterable<Entry>;

  added(timestamp: number): AsyncIterable<Entry>;
  removed(timestamp: number): AsyncIterable<string>;

  drop(): Promise<void>;
}
