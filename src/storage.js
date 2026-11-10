import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

let pgPool = null;
let pgInitPromise = null;

const memoryCache = new Map();
const inFlightReads = new Map();

function shouldUseSsl(connectionString) {
  if (/sslmode=disable/i.test(connectionString)) return false;
  if (/localhost|127\.0\.0\.1/i.test(connectionString)) return false;
  return true;
}

async function getPgPool() {
  if (!config.databaseUrl) return null;

  if (!pgPool) {
    pgPool = new Pool({
      connectionString: config.databaseUrl,
      ssl: shouldUseSsl(config.databaseUrl) ? { rejectUnauthorized: false } : false,
      max: 5,
    });
  }

  if (!pgInitPromise) {
    pgInitPromise = pgPool
      .query(
        `CREATE TABLE IF NOT EXISTS signage_store (
          key TEXT PRIMARY KEY,
          value JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`
      )
      .catch((err) => {
        pgInitPromise = null;
        throw err;
      });
  }

  await pgInitPromise;
  return pgPool;
}

export async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const base = path.basename(filePath);
  const tempFile = path.join(dir, `${base}.${process.pid}.tmp.json`);
  await fs.writeFile(tempFile, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tempFile, filePath);
}

async function readStoreItem(key, filePath) {
  if (memoryCache.has(key)) {
    return memoryCache.get(key);
  }

  if (inFlightReads.has(key)) {
    return inFlightReads.get(key);
  }

  const promise = (async () => {
    const pool = await getPgPool();
    let value;
    if (pool) {
      const res = await pool.query('SELECT value FROM signage_store WHERE key = $1', [key]);
      value = res.rows[0]?.value ?? null;
    } else {
      value = await readJsonIfExists(filePath);
    }
    memoryCache.set(key, value);
    return value;
  })().finally(() => {
    inFlightReads.delete(key);
  });

  inFlightReads.set(key, promise);
  return promise;
}

async function writeStoreItem(key, filePath, data) {
  const pool = await getPgPool();
  if (pool) {
    await pool.query(
      `INSERT INTO signage_store (key, value, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, JSON.stringify(data)]
    );
  } else {
    await writeJsonAtomic(filePath, data);
  }
  memoryCache.set(key, data);
}

export function getCacheStats() {
  return {
    properties: memoryCache.has('properties'),
    displaySettings: memoryCache.has('display_settings'),
    syncHistory: memoryCache.has('sync_history'),
  };
}

export function clearMemoryCache() {
  memoryCache.clear();
}

export function isDatabaseEnabled() {
  return Boolean(config.databaseUrl);
}

export async function readPropertiesData() {
  return readStoreItem('properties', config.dataFile);
}

export async function writePropertiesData(data) {
  await writeStoreItem('properties', config.dataFile, data);
}

export async function readSyncHistory() {
  const history = await readStoreItem('sync_history', config.historyFile);
  return Array.isArray(history) ? history : [];
}

export async function writeSyncHistory(history) {
  await writeStoreItem('sync_history', config.historyFile, history);
}

export async function readDisplaySettings() {
  const saved = await readStoreItem('display_settings', config.settingsFile);
  return {
    order: Array.isArray(saved?.order) ? saved.order : [],
    inactiveIds: Array.isArray(saved?.inactiveIds) ? saved.inactiveIds : [],
    updatedAt: saved?.updatedAt || null,
  };
}

export async function writeDisplaySettings(settings) {
  const normalized = {
    order: Array.isArray(settings.order) ? settings.order : [],
    inactiveIds: Array.isArray(settings.inactiveIds) ? settings.inactiveIds : [],
    updatedAt: new Date().toISOString(),
  };
  await writeStoreItem('display_settings', config.settingsFile, normalized);
  return normalized;
}

export async function closeStorage() {
  if (pgPool) {
    await pgPool.end();
    pgPool = null;
    pgInitPromise = null;
  }
}

/**
 * Applies saved order and inactive status to a list of properties.
 * Newly discovered properties not yet in `settings.order` are placed at the start.
 */
export function applyDisplaySettings(properties, settings) {
  const propMap = new Map(properties.map((p) => [p.id, p]));
  const inactiveSet = new Set(settings.inactiveIds || []);
  const orderedIdsSet = new Set();
  const existingOrdered = [];

  for (const id of settings.order || []) {
    if (propMap.has(id) && !orderedIdsSet.has(id)) {
      orderedIdsSet.add(id);
      existingOrdered.push(propMap.get(id));
    }
  }

  const newlyAdded = properties.filter((p) => !orderedIdsSet.has(p.id));
  const combined = [...newlyAdded, ...existingOrdered];

  return combined.map((p, index) => ({
    ...p,
    orderIndex: index,
    isActive: !inactiveSet.has(p.id),
  }));
}

/**
 * Keeps settings pruned to currently synced property IDs while preserving order and inactive state.
 */
export function reconcileSettingsWithProperties(properties, settings) {
  const validIds = new Set(properties.map((p) => p.id));
  const ordered = applyDisplaySettings(properties, settings);
  return {
    order: ordered.map((p) => p.id),
    inactiveIds: (settings.inactiveIds || []).filter((id) => validIds.has(id)),
    updatedAt: settings.updatedAt,
  };
}
