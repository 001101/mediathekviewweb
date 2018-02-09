import * as FS from 'fs';
import * as HJSON from 'hjson';
import * as Path from 'path';

interface Config {
  dataDirectoriy: string;

  elasticsearch: {
    host: string;
    port: number;
  }

  redis: {
    host: string;
    port: number;
    db: number;
  }

  importer: {
    latestCheckInterval: number;
    archiveCheckInterval: number;
    archiveRange: number;
    cache: boolean;
  }
}

const staticConfig: Config = {
  dataDirectoriy: './data',

  elasticsearch: {
    host: 'localhost',
    port: 9200
  },

  redis: {
    host: 'localhost',
    port: 6379,
    db: 0
  },

  importer: {
    latestCheckInterval: 60 * 2,
    archiveCheckInterval: 60 * 45,
    archiveRange: 10,
    cache: true
  }
}

const configPath = Path.join(__dirname, 'config.hjson');
const exists = FS.existsSync(configPath);

if (exists) {
  const configFileString = FS.readFileSync(configPath, { encoding: 'utf-8' });
  const configFile = HJSON.parse(configFileString) as Config;

  staticConfig.dataDirectoriy = configFile.dataDirectoriy;
  staticConfig.importer = configFile.importer;
}

export default staticConfig as Config;
