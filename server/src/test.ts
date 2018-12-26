import { timeout } from './common/utils';
import { InstanceProvider } from './instance-provider';
import { AsyncEnumerable } from './common/enumerable';

(async () => {
  const queueProvider = InstanceProvider.queueProvider();
  const lockProvider = InstanceProvider.lockProvider();

  const queue = queueProvider.get<number>('test', 5000, 3);
  await queue.initialize();

  const consumer = queue.getConsumer(false);

  for await (const job of consumer) {
    console.log(job);
    await timeout(1000);
    queue.acknowledge(job);
  }
})();

(async () => {
  await timeout(1000);
  const queueProvider = InstanceProvider.queueProvider();
  const lockProvider = InstanceProvider.lockProvider();

  const queue = queueProvider.get<number>('test', 5000, 3);
  await queue.initialize();

  AsyncEnumerable.fromRange(0, 5)
    .batch(50)
    .forEach(async (batch) => {
      await queue.enqueueMany(batch);
    });
})();
