import { Entry } from '../../common/models';
import { EntryRepository } from '../../repositories';

export type DeltaParameters = {
  timestamp: number
};

export type DeltaResult = {
  added: Entry[],
  removed: string[]
};

export class SearchApiEndpoint {
  private readonly entryRepository: EntryRepository;

  constructor(entryRepository: EntryRepository) {
    this.entryRepository = entryRepository;
  }

  async added({ timestamp }: DeltaParameters): Promise<DeltaResult> {
    throw new Error('not implemented' + timestamp.toString());
  }
}
