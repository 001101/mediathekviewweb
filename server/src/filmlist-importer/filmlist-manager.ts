import { IDatastoreProvider, IKey, ISet } from '../data-store';
import { IFilmlist } from './filmlist-interface';
import { IFilmlistProvider } from './filmlist-provider-interface';
import config from '../config';
import { random } from '../utils';
import * as Bull from 'bull';
import { ILockProvider, ILock } from '../lock';
import { QueueProvider, ImportQueueType } from '../queue';

const LATEST_CHECK_INTERVAL = config.importer.latestCheckInterval * 1000;
const FULL_CHECK_INTERVAL = config.importer.fullCheckTimeout * 1000;

export class FilmlistManager {
  private lastCheckTimestamp: IKey<number>;
  private importedFilmlistTimestamps: ISet<number>;
  private importQueue: Bull.Queue;
  private loopLock: ILock;

  constructor(private datastoreProvider: IDatastoreProvider, private filmlistProvider: IFilmlistProvider, private lockProvider: ILockProvider, private queueProvider: QueueProvider) {
    this.lastCheckTimestamp = datastoreProvider.getKey('manager:lastCheckTimestamp');
    this.importedFilmlistTimestamps = datastoreProvider.getSet('importedFilmlistTimestamps');
    this.importQueue = queueProvider.getImportQueue();

    this.loopLock = lockProvider.getLock('manager:loop');
  }

  run() {
    setTimeout(() => this.loop(), random(0, 5000));
  }

  private dispatchLoop() {
    setTimeout(() => this.loop(), random(5000, 15000));
  }

  private async loop() {
    const hasLock = await this.loopLock.lock();

    if (!hasLock) {
      return this.dispatchLoop();
    }

    let lastCheckTimestamp = await this.lastCheckTimestamp.get();

    if (lastCheckTimestamp == null) {
      lastCheckTimestamp = 0;
    }

    const difference = Date.now() - lastCheckTimestamp;

    await this.lastCheckTimestamp.set(Date.now());

    if (difference >= LATEST_CHECK_INTERVAL) {
      await this.checkLatest();
    }

    if (difference >= FULL_CHECK_INTERVAL) {
      await this.checkFull();
    }

    this.loopLock.unlock();

    this.dispatchLoop();
  }

  private async checkLatest() {
    const filmlist = await this.filmlistProvider.getLatest();
    const timestamp = await filmlist.getTimestamp();

    if (timestamp == null) {
      throw new Error('timestamp of filmlist should not be null');
    }

    const filmlistImported = await this.importedFilmlistTimestamps.has(timestamp);

    if (!filmlistImported) {
      await this.enqueueFilmlistImport(filmlist.ressource, timestamp);
      this.importedFilmlistTimestamps.add(timestamp);
    }
  }

  private async checkFull() {

  }

  private async enqueueFilmlistImport(ressource: string, timestamp: number) {
    const jobData: ImportQueueType = { ressource: ressource, timestamp: timestamp };
    await this.importQueue.add(jobData);
  }
}
