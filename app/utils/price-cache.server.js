const cache = new Map();
const TTL_MS = 60 * 60 * 1000; // 1 hour

export function getCached(productId) {
  const entry = cache.get(productId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(productId);
    return null;
  }
  return entry.data;
}

export function setCached(productId, data) {
  cache.set(productId, { data, expiresAt: Date.now() + TTL_MS });
}

export function invalidateCache(productId) {
  cache.delete(productId);
}
