import * as Needle from 'needle';
import { Nullable } from './common/utils';

let counter = 0;
let lastTimestamp: number = 0;
export function getUniqueID(): string {
  const timestamp = Date.now();

  if (timestamp != lastTimestamp) {
    counter = 0;
    lastTimestamp = timestamp;
  }

  return `${process.pid}:${timestamp}:${counter++}`;
}

export async function getLastModifiedHeaderTimestamp(url: string): Promise<Nullable<number>> {
  return new Promise<Nullable<number>>((resolve, reject) => {
    Needle.head(url, (error, response) => {
      if (error) {
        return reject(error);
      }

      if (response.statusCode != 200) {
        return reject(new Error(`StatusCode ${response.statusCode}: ${response.statusMessage}`));
      }

      const lastModified = response.headers['last-modified'] as string;
      if (lastModified != undefined) {
        var parsed = new Date(lastModified);
        return resolve(Math.floor(parsed.getTime() / 1000));
      } else {
        return resolve(null);
      }
    });
  });
}
