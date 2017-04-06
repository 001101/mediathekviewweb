import * as StoreJS from 'store';

import { Quality } from './model';

class SettingKeys {
  static DefaultQuality = 'defaultQuality';
  static Everywhere = 'everywhere';
  static Future = 'future';
  static PageSize = 'pageSize';
}

class DefaultSettings implements SettingsObject {
  everywhere = false;
  future = false;
  defaultQuality = Quality.High;
  pageSize = 15;
}

export interface SettingsObject {
  everywhere: boolean;
  future: boolean;
  defaultQuality: number;
  pageSize: number;
  save?(): void;
}

export class Settings {
  private static cache: { [key: string]: { [key: string]: any } } = {};

  private static get<T>(namespace: string, key: string): T {
    if (Settings.cache[namespace].hasOwnProperty(key) == false) {
      let storedValue = StoreJS.get(namespace + '_' + key);
      if (storedValue == undefined) {
        storedValue = DefaultSettings[key];
      }
      Settings.cache[namespace][key] = storedValue;
    }

    return Settings.cache[namespace][key];
  }

  private static set(namespace: string, key: string, value: any) {
    Settings.cache[namespace][key] = value;
  }

  private static save(namespace: string) {
    for (let key in Settings.cache[namespace]) {
      StoreJS.set(namespace + '_' + key, Settings.cache[namespace][key]);
    }
  }

  static getNamespace(namespace: string): SettingsObject {
    if (Settings.cache[namespace] == undefined) {
      Settings.cache[namespace] = {};
    }

    return {
      get everywhere(): boolean {
        return Settings.get<boolean>(namespace, SettingKeys.Everywhere);
      },
      set everywhere(value: boolean) {
        Settings.set(namespace, SettingKeys.Everywhere, value);
      },

      get future(): boolean {
        return Settings.get<boolean>(namespace, SettingKeys.Future);
      },
      set future(value: boolean) {
        Settings.set(namespace, SettingKeys.Future, value);
      },

      get pageSize(): number {
        return Settings.get<number>(namespace, SettingKeys.PageSize);
      },
      set pageSize(value: number) {
        Settings.set(namespace, SettingKeys.PageSize, value);
      },

      get defaultQuality(): number {
        return Settings.get<number>(namespace, SettingKeys.DefaultQuality);
      },
      set defaultQuality(value: number) {
        Settings.set(namespace, SettingKeys.DefaultQuality, value);
      },

      save(): void {
        Settings.save(namespace);
      }
    }
  }
}
