import { AsyncEnumerable } from '../../common/enumerable';
import { Logger } from '../../common/logger';
import { AnyIterable, currentTimestamp, now } from '../../common/utils';
import { config } from '../../config';
import { DatastoreFactory, DataType, Key } from '../../datastore';
import { DistributedLoopProvider } from '../../distributed-loop';
import { keys } from '../../keys';
import { FilmlistImportWithPartialId } from '../../model/filmlist-import';
import { Queue, QueueProvider } from '../../queue';
import { FilmlistImportRepository } from '../../repository/filmlists-import-repository';
import { Service, ServiceMetric } from '../../service';
import { ServiceBase } from '../../service-base';
import { Filmlist } from './filmlist';
import { FilmlistRepository } from './repository';

const LATEST_CHECK_INTERVAL = config.importer.latestCheckInterval * 1000;
const ARCHIVE_CHECK_INTERVAL = config.importer.archiveCheckInterval * 1000;
const MAX_AGE_DAYS = config.importer.archiveRange;
const MAX_AGE_SECONDS = MAX_AGE_DAYS * 24 * 60 * 60;

export class FilmlistManager extends ServiceBase implements Service {
  private readonly datastoreFactory: DatastoreFactory;
  private readonly filmlistImportRepository: FilmlistImportRepository;
  private readonly filmlistRepository: FilmlistRepository;
  private readonly distributedLoopProvider: DistributedLoopProvider;
  private readonly queueProvider: QueueProvider;
  private readonly logger: Logger;

  get metrics(): ReadonlyArray<ServiceMetric> {
    return [];
  }

  constructor(datastoreFactory: DatastoreFactory, filmlistImportRepository: FilmlistImportRepository, filmlistRepository: FilmlistRepository, distributedLoopProvider: DistributedLoopProvider, queueProvider: QueueProvider, logger: Logger) {
    super();

    this.datastoreFactory = datastoreFactory;
    this.filmlistImportRepository = filmlistImportRepository;
    this.filmlistRepository = filmlistRepository;
    this.distributedLoopProvider = distributedLoopProvider;
    this.queueProvider = queueProvider;
    this.logger = logger;
  }

  protected async run(): Promise<void> {
    const lastLatestCheck = this.datastoreFactory.key<Date>(keys.LastLatestCheck, DataType.Date);
    const lastArchiveCheck = this.datastoreFactory.key<Date>(keys.LastArchiveCheck, DataType.Date);
    const importQueue = this.queueProvider.get<Filmlist>(keys.FilmlistImportQueue, 5 * 60 * 1000, 3);
    const distributedLoop = this.distributedLoopProvider.get(keys.FilmlistManagerLoop, true);

    await importQueue.initialize();

    const loopController = distributedLoop.run(async () => await this.loop(lastLatestCheck, lastArchiveCheck, importQueue), 60000, 10000);
    await this.cancellationToken; // tslint:disable-line: await-promise

    await Promise.all([
      importQueue.dispose(),
      loopController.stop()
    ]);
  }

  private async loop(lastLatestCheck: Key<Date>, lastArchiveCheck: Key<Date>, importQueue: Queue<Filmlist>): Promise<void> {
    await this.compareTime(lastLatestCheck, LATEST_CHECK_INTERVAL, async () => await this.checkLatest(importQueue));
    await this.compareTime(lastArchiveCheck, ARCHIVE_CHECK_INTERVAL, async () => await this.checkArchive(importQueue));
  }

  private async compareTime(dateKey: Key<Date>, interval: number, func: () => Promise<void>): Promise<void> {
    let date = await dateKey.get();

    if (date == undefined) {
      date = new Date(0);
    }

    const difference = Date.now() - date.valueOf();

    if (difference >= interval) {
      await func();
      await dateKey.set(now());
    }
  }

  private async checkLatest(importQueue: Queue<Filmlist>): Promise<void> {
    this.logger.verbose('checking for new current-filmlist');
    const filmlist = await this.filmlistRepository.getLatest();
    await this.enqueueMissingFilmlists([filmlist], 0, importQueue);
  }

  private async checkArchive(importQueue: Queue<Filmlist>): Promise<void> {
    this.logger.verbose('checking for new archive-filmlist');

    const minimumTimestamp = currentTimestamp() - MAX_AGE_SECONDS;

    const archive = this.filmlistRepository.getArchive();
    await this.enqueueMissingFilmlists(archive, minimumTimestamp, importQueue);
  }

  private async enqueueMissingFilmlists(filmlists: AnyIterable<Filmlist>, minimumTimestamp: number, importQueue: Queue<Filmlist>): Promise<void> {
    const filmlistsEnumerable = new AsyncEnumerable(filmlists);

    await filmlistsEnumerable
      .while(() => !this.cancellationToken.isSet)
      .filter((filmlist) => filmlist.timestamp >= minimumTimestamp)
      .filter(async (filmlist) => !(await this.filmlistImportRepository.has(filmlist.id)))
      .parallelForEach(3, async (filmlist) => await this.enqueueFilmlist(filmlist, importQueue));
  }

  private async enqueueFilmlist(filmlist: Filmlist, importQueue: Queue<Filmlist>): Promise<void> {
    await importQueue.enqueue(filmlist);

    const filmlistImport: FilmlistImportWithPartialId = {
      filmlistId: filmlist.id,
      enqueuedTimestamp: currentTimestamp(),
      processedTimestamp: null,
      numberOfEntries: null
    };

    await this.filmlistImportRepository.insert(filmlistImport);
  }
}
