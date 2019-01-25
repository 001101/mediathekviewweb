import { AsyncEnumerable } from '../../common/enumerable';
import { Logger } from '../../common/logger';
import { now } from '../../common/utils';
import { config } from '../../config';
import { DatastoreFactory, DataType, Key, Set } from '../../datastore';
import { DistributedLoop, DistributedLoopProvider } from '../../distributed-loop';
import { LoopController } from '../../distributed-loop/controller';
import { Keys } from '../../keys';
import { Queue, QueueProvider } from '../../queue';
import { Service } from '../../service';
import { ServiceBase } from '../../service-base';
import { Filmlist } from './filmlist';
import { FilmlistRepository } from './repository';
import { AsyncDisposer } from '../../common/disposable';

const LATEST_CHECK_INTERVAL = config.importer.latestCheckInterval * 1000;
const ARCHIVE_CHECK_INTERVAL = config.importer.archiveCheckInterval * 1000;
const MAX_AGE_DAYS = config.importer.archiveRange;

export class FilmlistManager extends ServiceBase implements Service {
  private readonly disposer: AsyncDisposer;
  private readonly filmlistRepository: FilmlistRepository;
  private readonly enqueuedFilmlistDates: Set<Date>;
  private readonly importedFilmlistDates: Set<Date>;
  private readonly lastLatestCheck: Key<Date>;
  private readonly lastArchiveCheck: Key<Date>;
  private readonly importQueue: Queue<Filmlist>;
  private readonly distributedLoop: DistributedLoop;
  private readonly logger: Logger;

  private loopController: LoopController;

  constructor(datastoreFactory: DatastoreFactory, filmlistRepository: FilmlistRepository, distributedLoopProvider: DistributedLoopProvider, queueProvider: QueueProvider, logger: Logger) {
    super();

    this.filmlistRepository = filmlistRepository;
    this.logger = logger;

    this.disposer = new AsyncDisposer();
    this.lastLatestCheck = datastoreFactory.key(Keys.LastLatestCheck, DataType.Date);
    this.lastArchiveCheck = datastoreFactory.key(Keys.LastArchiveCheck, DataType.Date);
    this.enqueuedFilmlistDates = datastoreFactory.set(Keys.EnqueuedFilmlistDates, DataType.Date);
    this.importedFilmlistDates = datastoreFactory.set(Keys.ImportedFilmlistDates, DataType.Date);
    this.importQueue = queueProvider.get(Keys.FilmlistImportQueue, 5 * 60 * 1000, 3);
    this.distributedLoop = distributedLoopProvider.get(Keys.FilmlistManagerLoop, true);

    this.disposer.addDisposeTasks(async () => await this.importQueue.dispose());
  }

  protected async _dispose(): Promise<void> {
    await this.disposer.dispose();
  }

  protected async _initialize(): Promise<void> {
    await this.importQueue.initialize();
  }

  protected async _start(): Promise<void> {
    this.loopController = this.distributedLoop.run(async () => await this.loop(), 60000, 10000);
    this.disposer.addDisposeTasks(async () => await this.loopController.stop());

    await this.loopController.stopped;
  }

  protected async _stop(): Promise<void> {
    await this.loopController.stop();
  }

  private async loop(): Promise<void> {
    await this.compareTime(this.lastLatestCheck, LATEST_CHECK_INTERVAL, async () => await this.checkLatest());
    await this.compareTime(this.lastArchiveCheck, ARCHIVE_CHECK_INTERVAL, async () => await this.checkArchive());
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

  private async checkLatest(): Promise<void> {
    this.logger.verbose('checking for new current-filmlist');
    const filmlist = await this.filmlistRepository.getLatest();
    await this.checkFilmlist(filmlist);
  }

  private async checkArchive(): Promise<void> {
    this.logger.verbose('checking for new archive-filmlist');

    const minimumDate = now();
    minimumDate.setDate(minimumDate.getDate() - MAX_AGE_DAYS);

    const archiveIterable = this.filmlistRepository.getArchive();
    const filmlists = new AsyncEnumerable(archiveIterable);

    await filmlists
      .cancelable(this.disposer.disposingPromise)
      .filter((filmlist) => filmlist.date >= minimumDate)
      .parallelForEach(3, async (filmlist) => await this.checkFilmlist(filmlist));
  }

  private async checkFilmlist(filmlist: Filmlist): Promise<void> {
    const imported = await this.importedFilmlistDates.has(filmlist.date);

    if (!imported) {
      await this.enqueueFilmlistImport(filmlist);
    }
  }

  private async enqueueFilmlistImport(filmlist: Filmlist): Promise<void> {
    const isEnqueued = await this.enqueuedFilmlistDates.has(filmlist.date);

    if (isEnqueued) {
      return;
    }

    await this.importQueue.enqueue(filmlist);
    await this.enqueuedFilmlistDates.add(filmlist.date);
  }
}
