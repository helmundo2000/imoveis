import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { scrapeHabiestiloProperties } from './scraper.js';
import {
  closeStorage,
  readDisplaySettings,
  readPropertiesData,
  readSyncHistory,
  reconcileSettingsWithProperties,
  writeDisplaySettings,
  writePropertiesData,
  writeSyncHistory,
} from './storage.js';

const MAX_HISTORY_ENTRIES = 30;

function parseCliArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (arg.startsWith('--business=')) {
      options.businessFilter = arg.slice('--business='.length);
    } else if (arg.startsWith('--limit=')) {
      const limit = Number.parseInt(arg.slice('--limit='.length), 10);
      if (Number.isFinite(limit) && limit > 0) options.limit = limit;
    } else if (arg.startsWith('--photos=')) {
      const photos = Number.parseInt(arg.slice('--photos='.length), 10);
      if (Number.isFinite(photos) && photos > 0) options.maxPhotos = photos;
    }
  }
  return options;
}

function summarizeProperty(p) {
  return {
    id: p.id,
    reference: p.reference || '',
    title: p.title || '',
    businessType: p.businessType || '',
    priceValue: p.priceValue ?? 0,
    priceFormatted: p.priceFormatted || '',
    location: p.location || '',
    detailUrl: p.detailUrl || '',
  };
}

/**
 * Computes added, removed, and price-changed properties between two sync snapshots.
 */
export function computeSyncDiff(previousData, nextData) {
  const prevList = Array.isArray(previousData?.properties) ? previousData.properties : [];
  const nextList = Array.isArray(nextData?.properties) ? nextData.properties : [];
  const isInitialSync = !previousData || !Array.isArray(previousData.properties);

  const prevMap = new Map(prevList.map((p) => [p.id, p]));
  const nextMap = new Map(nextList.map((p) => [p.id, p]));

  const added = [];
  const removed = [];
  const priceChanged = [];
  let unchangedCount = 0;

  for (const nextProp of nextList) {
    const prevProp = prevMap.get(nextProp.id);
    if (!prevProp) {
      added.push(summarizeProperty(nextProp));
      continue;
    }

    const priceChangedFlag =
      Number(prevProp.priceValue ?? 0) !== Number(nextProp.priceValue ?? 0) ||
      (prevProp.priceFormatted || '') !== (nextProp.priceFormatted || '');

    if (priceChangedFlag) {
      priceChanged.push({
        ...summarizeProperty(nextProp),
        oldPriceValue: prevProp.priceValue ?? 0,
        oldPriceFormatted: prevProp.priceFormatted || '',
        newPriceValue: nextProp.priceValue ?? 0,
        newPriceFormatted: nextProp.priceFormatted || '',
        deltaValue: Number(nextProp.priceValue ?? 0) - Number(prevProp.priceValue ?? 0),
      });
    } else {
      unchangedCount += 1;
    }
  }

  for (const prevProp of prevList) {
    if (!nextMap.has(prevProp.id)) {
      removed.push(summarizeProperty(prevProp));
    }
  }

  return {
    isInitialSync,
    syncedAt: nextData.syncedAt,
    previousSyncedAt: previousData?.syncedAt || null,
    totalCount: nextList.length,
    unchangedCount,
    added,
    removed,
    priceChanged,
  };
}

/**
 * Runs a full sync, computes diff against previous snapshot, and atomically writes data files.
 */
export async function runSync(options = {}) {
  const previousData = await readPropertiesData();
  const payload = await scrapeHabiestiloProperties(options);
  const diff = computeSyncDiff(previousData, payload);

  const currentSettings = await readDisplaySettings();
  const reconciled = reconcileSettingsWithProperties(payload.properties, currentSettings);
  if (currentSettings.order.length > 0 || currentSettings.inactiveIds.length > 0) {
    await writeDisplaySettings(reconciled);
  }

  payload.lastDiff = diff;
  await writePropertiesData(payload);

  const existingHistory = await readSyncHistory();
  const nextHistory = [diff, ...existingHistory].slice(0, MAX_HISTORY_ENTRIES);
  await writeSyncHistory(nextHistory);

  return { ...payload, diff };
}

function printDiffSummary(diff) {
  const fmt = (p) => (p.reference ? `[${p.reference}] ${p.title}` : p.title);
  console.log(
    `[sync] Alterações: +${diff.added.length} adicionados | ~${diff.priceChanged.length} alteração de valor | -${diff.removed.length} saíram`
  );
  if (diff.removed.length > 0) {
    console.log('[sync] Saíram:', diff.removed.map(fmt).join('; '));
  }
  if (diff.priceChanged.length > 0) {
    console.log(
      '[sync] Mudança de valor:',
      diff.priceChanged
        .map((p) => `${fmt(p)} (${p.oldPriceFormatted} -> ${p.newPriceFormatted})`)
        .join('; ')
    );
  }
  if (diff.added.length > 0) {
    console.log('[sync] Adicionados:', diff.added.map(fmt).join('; '));
  }
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  const cliOptions = parseCliArgs(process.argv.slice(2));
  console.log('[sync] A obter imóveis de', config.siteUrl, '...');
  try {
    const result = await runSync(cliOptions);
    console.log(
      `[sync] Concluído: ${result.count} imóveis guardados (${result.syncedAt})`
    );
    printDiffSummary(result.diff);
  } catch (err) {
    console.error('[sync] Erro:', err.message);
    process.exitCode = 1;
  } finally {
    await closeStorage();
  }
}
