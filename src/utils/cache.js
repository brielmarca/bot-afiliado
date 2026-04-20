class SimpleCache {
  constructor(options = {}) {
    this.ttl = options.ttl || 60000;
    this.maxSize = options.maxSize || 100;
    this.cache = new Map();
  }

  _evict() {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (value.expiresAt && now > value.expiresAt) {
        this.cache.delete(key);
      }
    }

    while (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;

    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return item.value;
  }

  set(key, value, customTtl) {
    this._evict();

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (customTtl || this.ttl),
    });
  }

  has(key) {
    return this.get(key) !== null;
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }
}

const rssCache = new SimpleCache({ ttl: 10 * 60 * 1000, maxSize: 200 });
const linkCache = new SimpleCache({ ttl: 30 * 60 * 1000, maxSize: 1000 });

export { SimpleCache, rssCache, linkCache };