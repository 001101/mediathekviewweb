import { timeout } from './common/utils';
import { InstanceProvider } from './instance-provider';
import { AsyncEnumerable } from './common/enumerable';

(async () => {
  const queueProvider = await InstanceProvider.queueProvider();
  const lockProvider = await InstanceProvider.lockProvider();

  const queue = queueProvider.get<number>('test', 5);

  const consumer = queue.getConsumer(false);

  for await (const item of consumer) {
    console.log(item);
    await timeout(100);
  }
})();

(async () => {
  await timeout(1000);
  const queueProvider = await InstanceProvider.queueProvider();
  const lockProvider = await InstanceProvider.lockProvider();

  const queue = queueProvider.get<number>('test', 5);


  AsyncEnumerable.fromRange(0, 100000)
    .batch(50)
    .forEach(async (batch) => {
      await queue.enqueueMany(batch);
    });
})();
