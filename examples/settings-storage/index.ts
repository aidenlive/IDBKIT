/**
 * Example: Settings storage
 * -------------------------
 * A tiny, typed key/value store on top of idbkit — the pattern for app
 * preferences, feature flags, and small bits of persistent state. Defaults are
 * applied on read so missing keys behave predictably.
 */
import { openDatabase, type Database, type Schema } from 'idbkit';

/** Your app's settings shape and defaults in one place. */
export interface Settings {
  theme: 'light' | 'dark' | 'system';
  fontSize: number;
  notifications: boolean;
  lastOpenedTab: string;
}

const DEFAULTS: Settings = {
  theme: 'system',
  fontSize: 14,
  notifications: true,
  lastOpenedTab: 'home',
};

interface SettingRow {
  key: string;
  value: unknown;
}

interface SettingsDB extends Schema {
  settings: { key: string; value: SettingRow };
}

export class SettingsStore {
  private constructor(private readonly db: Database<SettingsDB>) {}

  static async open(name = 'example-settings'): Promise<SettingsStore> {
    const db = await openDatabase<SettingsDB>({
      name,
      version: 1,
      stores: { settings: { keyPath: 'key' } },
    });
    return new SettingsStore(db);
  }

  /** Read one setting, falling back to the default. */
  async get<K extends keyof Settings>(key: K): Promise<Settings[K]> {
    const row = await this.db.store('settings').get(key as string);
    return (row ? (row.value as Settings[K]) : DEFAULTS[key]);
  }

  /** Write one setting. */
  async set<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
    await this.db.store('settings').put({ key: key as string, value });
  }

  /** Read every setting merged over the defaults. */
  async all(): Promise<Settings> {
    const rows = await this.db.store('settings').getAll();
    const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return { ...DEFAULTS, ...stored } as Settings;
  }

  /** Update several settings atomically. */
  async patch(values: Partial<Settings>): Promise<void> {
    await this.db.transaction(['settings'], 'readwrite', async (tx) => {
      const store = tx.store('settings');
      for (const [key, value] of Object.entries(values)) {
        await store.put({ key, value });
      }
    });
  }

  /** Reset a single setting back to its default. */
  async reset<K extends keyof Settings>(key: K): Promise<void> {
    await this.db.store('settings').delete(key as string);
  }

  /** Reset everything. */
  async resetAll(): Promise<void> {
    await this.db.store('settings').clear();
  }

  close(): void {
    this.db.close();
  }
}

// Demo when run directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  const run = async () => {
    const settings = await SettingsStore.open(`example-settings-${Date.now()}`);
    console.log('default theme:', await settings.get('theme'));

    await settings.set('theme', 'dark');
    await settings.patch({ fontSize: 18, notifications: false });

    console.log('all settings:', await settings.all());

    await settings.reset('theme');
    console.log('theme after reset:', await settings.get('theme'));

    settings.close();
  };
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
