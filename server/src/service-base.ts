import { MicroService, MicroServiceName, Service } from './service';

export enum ServiceState {
  Uninitialized,
  Initializing,
  Running,
  Stopping,
  Stopped,
  Disposing,
  Disposed,
  Erroneous
}

export abstract class ServiceBase implements Service {
  private state: ServiceState;

  protected stopRequested: boolean;

  private get stateString(): string {
    return ServiceState[this.state].toLowerCase();
  }

  constructor() {
    this.state = ServiceState.Uninitialized;
    this.stopRequested = false;
  }

  protected abstract _dispose(): Promise<void>;
  protected abstract _initialize(): Promise<void>;
  protected abstract _start(): Promise<void>;
  protected abstract _stop(): Promise<void>;

  async dispose(): Promise<void> {
    if (this.state == ServiceState.Disposing || this.state == ServiceState.Disposed) {
      throw new Error(`cannot dispose service, it is ${this.stateString}`);
    }

    if (this.state == ServiceState.Running) {
      await this.stop();
    }

    try {
      this.state = ServiceState.Disposing;
      await this._dispose();
      this.state = ServiceState.Disposed;
    }
    catch (error) {
      this.state = ServiceState.Erroneous;
      throw error;
    }
  }

  async initialize(): Promise<void> {
    if (this.state != ServiceState.Uninitialized) {
      throw new Error(`cannot initialize service, it is ${this.stateString}`);
    }

    try {
      this.state = ServiceState.Initializing;
      await this._initialize();
      this.state = ServiceState.Stopped;
    }
    catch (error) {
      this.state = ServiceState.Erroneous;
      throw error;
    }
  }

  async start(): Promise<void> {
    if (this.state != ServiceState.Stopped) {
      throw new Error(`cannot run service, it is ${this.stateString}`);
    }

    try {
      this.stopRequested = false;
      this.state = ServiceState.Running;
      await this._start();
      this.state = ServiceState.Stopped;
    }
    catch (error) {
      this.state = ServiceState.Erroneous;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.state != ServiceState.Running) {
      throw new Error(`cannot stop service, it is ${this.stateString}`);
    }

    try {
      this.stopRequested = true;
      this.state = ServiceState.Stopping;
      await this._stop();
      this.state = ServiceState.Stopped;
    }
    catch (error) {
      this.state = ServiceState.Erroneous;
      throw error;
    }
  }
}

export abstract class MicroServiceBase extends ServiceBase implements MicroService {
  readonly [MicroServiceName]: string;

  constructor(serviceName: string) {
    super();

    this[MicroServiceName] = serviceName;
  }
}
