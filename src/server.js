import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { runSync } from './sync.js';
import {
  applyDisplaySettings,
  closeStorage,
  getCacheStats,
  isDatabaseEnabled,
  readDisplaySettings,
  readPropertiesData,
  readSyncHistory,
  writeDisplaySettings,
} from './storage.js';

const app = express();
app.use(express.json());

let activeSyncPromise = null;

function timingSafeMatch(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function isAuthorizedAdmin(req) {
  if (!config.auth.password) return true;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  let decoded = '';
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const sep = decoded.indexOf(':');
  if (sep === -1) return false;
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  return timingSafeMatch(user, config.auth.user) && timingSafeMatch(pass, config.auth.password);
}

function requireAdminAuth(req, res, next) {
  if (isAuthorizedAdmin(req)) {
    next();
    return;
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="Habiestilo Dashboard"');
  res.status(401).json({ error: 'Autenticação necessária.' });
}

function triggerSync(options = {}) {
  if (!activeSyncPromise) {
    activeSyncPromise = runSync(options).finally(() => {
      activeSyncPromise = null;
    });
  }
  return activeSyncPromise;
}

// Allow Xopvision / Tizen WebView / iframe embedding and cross-origin reads
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cache-Control, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    storage: isDatabaseEnabled() ? 'postgres' : 'json',
    authEnabled: Boolean(config.auth.password),
    cached: getCacheStats(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/config', (_req, res) => {
  res.json(config.display);
});

app.get('/api/properties', async (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === '1';
    if (includeInactive && config.auth.password && !isAuthorizedAdmin(req)) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Habiestilo Dashboard"');
      res.status(401).json({ error: 'Autenticação necessária.' });
      return;
    }

    const data = await readPropertiesData();
    if (!data) {
      res.json({
        source: config.siteUrl,
        syncedAt: null,
        version: null,
        count: 0,
        activeCount: 0,
        totalCount: 0,
        needsSync: true,
        properties: [],
      });
      return;
    }

    const settings = await readDisplaySettings();
    const orderedAll = applyDisplaySettings(data.properties || [], settings);
    const visible = includeInactive ? orderedAll : orderedAll.filter((p) => p.isActive);
    const activeCount = orderedAll.filter((p) => p.isActive).length;

    res.json({
      ...data,
      version: `${data.syncedAt || ''}|${settings.updatedAt || ''}`,
      settingsUpdatedAt: settings.updatedAt,
      count: visible.length,
      activeCount,
      totalCount: orderedAll.length,
      properties: visible,
    });
  } catch {
    res.status(500).json({ error: 'Erro ao ler dados dos imóveis.' });
  }
});

app.put('/api/properties/order', requireAdminAuth, async (req, res) => {
  try {
    const requestedOrder = req.body?.order;
    if (!Array.isArray(requestedOrder)) {
      res.status(400).json({ ok: false, error: 'Campo "order" deve ser um array de IDs.' });
      return;
    }

    const numericOrder = requestedOrder
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id));

    const current = await readDisplaySettings();
    const saved = await writeDisplaySettings({
      ...current,
      order: numericOrder,
    });

    res.json({ ok: true, order: saved.order, settingsUpdatedAt: saved.updatedAt });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch('/api/properties/:id/status', requireAdminAuth, async (req, res) => {
  try {
    const propertyId = Number(req.params.id);
    if (!Number.isFinite(propertyId)) {
      res.status(400).json({ ok: false, error: 'ID de imóvel inválido.' });
      return;
    }

    if (typeof req.body?.active !== 'boolean') {
      res.status(400).json({ ok: false, error: 'Campo "active" deve ser booleano.' });
      return;
    }

    const current = await readDisplaySettings();
    const inactiveSet = new Set(current.inactiveIds);
    if (req.body.active) {
      inactiveSet.delete(propertyId);
    } else {
      inactiveSet.add(propertyId);
    }

    const saved = await writeDisplaySettings({
      ...current,
      inactiveIds: [...inactiveSet],
    });

    res.json({
      ok: true,
      id: propertyId,
      active: req.body.active,
      inactiveIds: saved.inactiveIds,
      settingsUpdatedAt: saved.updatedAt,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/sync-history', requireAdminAuth, async (_req, res) => {
  try {
    const list = await readSyncHistory();
    res.json({ latest: list[0] || null, history: list });
  } catch {
    res.status(500).json({ error: 'Erro ao ler histórico de sincronizações.' });
  }
});

app.post('/api/sync', requireAdminAuth, async (req, res) => {
  try {
    const options = {};
    if (typeof req.body?.businessFilter === 'string') {
      options.businessFilter = req.body.businessFilter;
    }
    if (Number.isFinite(Number(req.body?.limit)) && Number(req.body.limit) > 0) {
      options.limit = Number(req.body.limit);
    }
    if (Number.isFinite(Number(req.body?.maxPhotos)) && Number(req.body.maxPhotos) > 0) {
      options.maxPhotos = Number(req.body.maxPhotos);
    }

    const result = await triggerSync(options);
    res.json({
      ok: true,
      syncedAt: result.syncedAt,
      count: result.count,
      totalFetched: result.totalFetched,
      diff: result.diff,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Protect dashboard assets when ADMIN_PASSWORD is configured
app.use(['/dashboard', '/dashboard.html', '/dashboard.css', '/dashboard.js'], requireAdminAuth);

app.get('/dashboard', (_req, res) => {
  res.sendFile(path.join(config.publicDir, 'dashboard.html'));
});

app.use(express.static(config.publicDir));

async function ensureInitialData() {
  try {
    const [existing] = await Promise.all([
      readPropertiesData(),
      readDisplaySettings(),
      readSyncHistory(),
    ]);
    if (!existing || !Array.isArray(existing.properties) || existing.properties.length === 0) {
      console.log('[server] Sem dados iniciais. A executar primeira sincronização...');
      const res = await triggerSync();
      console.log(`[server] Sincronização inicial concluída (${res.count} imóveis).`);
    } else {
      console.log(`[server] Cache carregada (${existing.properties.length} imóveis).`);
    }
  } catch (err) {
    console.error('[server] Falha na sincronização inicial:', err.message);
  }
}

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(
    `[server] Digital Signage Habiestilo a correr na porta ${config.port} (storage: ${
      isDatabaseEnabled() ? 'postgres' : 'json'
    }, auth: ${config.auth.password ? 'ativa' : 'desativada'})`
  );
  ensureInitialData();

  if (config.sync.autoSyncMinutes > 0) {
    const intervalMs = config.sync.autoSyncMinutes * 60 * 1000;
    console.log(`[server] Auto-sync agendado a cada ${config.sync.autoSyncMinutes} min.`);
    setInterval(() => {
      triggerSync().catch((err) => {
        console.error('[server] Erro no auto-sync:', err.message);
      });
    }, intervalMs);
  }
});

async function shutdown() {
  server.close(async () => {
    await closeStorage();
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
