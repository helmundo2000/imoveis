import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  rootDir: ROOT_DIR,
  dataDir: path.join(ROOT_DIR, 'data'),
  dataFile: path.join(ROOT_DIR, 'data', 'properties.json'),
  historyFile: path.join(ROOT_DIR, 'data', 'sync-history.json'),
  settingsFile: path.join(ROOT_DIR, 'data', 'display-settings.json'),
  publicDir: path.join(ROOT_DIR, 'public'),
  port: parsePositiveInt(process.env.PORT, 3000),
  siteUrl: process.env.SITE_URL || 'https://www.habiestilo.com',
  apiBaseUrl: process.env.API_BASE_URL || 'https://websiteapi.egorealestate.com/v1',
  databaseUrl: (process.env.DATABASE_URL || '').trim(),
  auth: {
    user: process.env.ADMIN_USER || 'admin',
    password: process.env.ADMIN_PASSWORD || '',
  },
  display: {
    propertyDurationMs: parsePositiveInt(process.env.PROPERTY_DURATION_MS, 25000),
    photoDurationMs: parsePositiveInt(process.env.PHOTO_DURATION_MS, 5000),
    photoFadeMs: parsePositiveInt(process.env.PHOTO_FADE_MS, 1000),
    pollIntervalMs: parsePositiveInt(process.env.POLL_INTERVAL_MS, 30000),
  },
  sync: {
    maxPhotosPerProperty: parsePositiveInt(process.env.MAX_PHOTOS_PER_PROPERTY, 5),
    businessFilter: process.env.BUSINESS_FILTER || '',
    limit: parsePositiveInt(process.env.SYNC_LIMIT, 0),
    autoSyncMinutes: parsePositiveInt(process.env.AUTO_SYNC_MINUTES, 0),
  },
};
