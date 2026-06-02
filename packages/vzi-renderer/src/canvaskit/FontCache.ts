/**
 * 字体缓存管理器
 *
 * 使用 IndexedDB 缓存字体数据，避免重复下载
 */

const DB_NAME = 'VZI_FontCache';
const DB_VERSION = 1;
const STORE_NAME = 'fonts';

export interface CachedFont {
  url: string;
  data: ArrayBuffer;
  timestamp: number;
  size: number;
}

/**
 * 字体缓存管理器
 */
export class FontCache {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;
  private readonly cacheAvailable =
    typeof indexedDB !== 'undefined' && indexedDB !== null;
  private unavailableWarned = false;

  private warnUnavailable(): void {
    if (this.unavailableWarned) {
      return;
    }
    this.unavailableWarned = true;
    console.warn('[FontCache] IndexedDB 不可用，字体缓存降级为仅内存模式');
  }

  /**
   * 初始化 IndexedDB
   */
  async init(): Promise<void> {
    if (!this.cacheAvailable) {
      this.warnUnavailable();
      return;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('[FontCache] 初始化失败:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'url' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });

    return this.initPromise;
  }

  /**
   * 获取缓存的字体
   */
  async get(url: string): Promise<ArrayBuffer | null> {
    await this.init();
    if (!this.cacheAvailable) {
      return null;
    }
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(url);

      request.onsuccess = () => {
        const cached = request.result as CachedFont | undefined;
        if (cached) {
          resolve(cached.data);
        } else {
          resolve(null);
        }
      };

      request.onerror = () => {
        console.error('[FontCache] 读取失败:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * 缓存字体
   */
  async set(url: string, data: ArrayBuffer): Promise<void> {
    await this.init();
    if (!this.cacheAvailable) {
      return;
    }
    if (!this.db) return;

    const cached: CachedFont = {
      url,
      data,
      timestamp: Date.now(),
      size: data.byteLength,
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(cached);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        console.error('[FontCache] 缓存失败:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * 清除所有缓存
   */
  async clear(): Promise<void> {
    await this.init();
    if (!this.cacheAvailable) {
      return;
    }
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        console.error('[FontCache] 清除失败:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * 获取缓存统计信息
   */
  async getStats(): Promise<{ count: number; totalSize: number }> {
    await this.init();
    if (!this.cacheAvailable) {
      return { count: 0, totalSize: 0 };
    }
    if (!this.db) return { count: 0, totalSize: 0 };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const fonts = request.result as CachedFont[];
        const totalSize = fonts.reduce((sum, font) => sum + font.size, 0);
        resolve({
          count: fonts.length,
          totalSize,
        });
      };

      request.onerror = () => {
        console.error('[FontCache] 获取统计失败:', request.error);
        reject(request.error);
      };
    });
  }
}
