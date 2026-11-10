import QRCode from 'qrcode';
import { config } from './config.js';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Extracts a fresh public APIToken and requestID from Habiestilo's listings page.
 */
async function fetchSiteCredentials(siteUrl) {
  const listingsUrl = `${siteUrl.replace(/\/$/, '')}/imoveis`;
  const response = await fetch(listingsUrl, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
  });

  if (!response.ok) {
    throw new Error(`Falha ao aceder a ${listingsUrl} (HTTP ${response.status})`);
  }

  const html = await response.text();
  const apiToken = html.match(/"APIToken":"([^"]+)"/)?.[1];
  const requestId = html.match(/'requestID':'([^']+)'/)?.[1];

  if (!apiToken || !requestId) {
    throw new Error('Não foi possível extrair APIToken ou requestID da página da Habiestilo.');
  }

  return { apiToken, requestId };
}

/**
 * Fetches one page of properties from the public eGO Real Estate website API.
 */
async function fetchPropertiesPage({ apiBaseUrl, siteUrl, apiToken, requestId, page, pageSize }) {
  const url = new URL(`${apiBaseUrl.replace(/\/$/, '')}/Properties`);
  url.searchParams.set('lng', 'pt-pt');
  url.searchParams.set('pag', String(page));
  url.searchParams.set('nre', String(pageSize));
  url.searchParams.set('oar', '1');
  url.searchParams.set('gather_attributes', '1');

  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      AuthorizationToken: apiToken,
      'x-requestid': requestId,
      'x-async': 'true',
      'X-Served-By': 'JanelaDigital',
      Origin: siteUrl,
      Referer: `${siteUrl}/`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Erro na API de imóveis (HTTP ${response.status})`);
  }

  return response.json();
}

function slugify(value) {
  return String(value || 'imovel')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160) || 'imovel';
}

function formatPrice(priceValue, businessName) {
  if (!Number.isFinite(priceValue) || priceValue <= 0) {
    return 'Sob Consulta';
  }

  const formatted = Math.round(priceValue)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  const isRental = /arrend/i.test(businessName || '');
  return isRental ? `${formatted}€/mês` : `${formatted}€`;
}

function formatBusinessBadge(businessName) {
  const normalized = (businessName || '').toLowerCase();
  if (normalized.includes('arrend')) {
    return { pt: 'PARA ARRENDAR', en: 'FOR RENT' };
  }
  if (normalized.includes('trespasse')) {
    return { pt: 'TRESPASSE', en: 'FOR TRANSFER' };
  }
  if (normalized.includes('venda')) {
    return { pt: 'PARA VENDA', en: 'FOR SALE' };
  }
  return { pt: (businessName || 'DISPONÍVEL').toUpperCase(), en: '' };
}

function formatArea(raw) {
  const num = Number(raw?.GrossArea) > 0
    ? Number(raw.GrossArea)
    : Number(raw?.NetArea) > 0
      ? Number(raw.NetArea)
      : Number(raw?.LandArea) > 0
        ? Number(raw.LandArea)
        : 0;

  if (!Number.isFinite(num) || num <= 0) return null;
  const rounded = Number.isInteger(num) ? String(num) : num.toFixed(1).replace(/\.0$/, '');
  return `${rounded} m²`;
}

function formatLocation(raw) {
  const parts = [];
  const municipality = (raw.Municipality || '').trim();
  const zone = (raw.Zone || '').trim();
  const parish = (raw.Parish || '').replace(/\s*\([^)]*\)/g, '').trim();

  if (municipality) parts.push(municipality);
  const sub = zone || parish;
  if (sub && sub.toLowerCase() !== municipality.toLowerCase()) {
    parts.push(sub);
  }
  return parts.join(' | ') || raw.District || 'Portugal';
}

function extractPortugueseDescription(rawDesc, maxLength = 180) {
  if (!rawDesc) return '';

  // Many listings append English/French translations after blank lines.
  const blocks = String(rawDesc)
    .replace(/\r\n/g, '\n')
    .split(/\n+/)
    .map((b) => b.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const foreignMarkers =
    /^(I present|I am pleased|Welcome to|Located in|Situated in|This magnificent|Discover this|Property description|We present|Je vous présente|Bienvenue|Situé|Découvrez|Ce magnifique|Cette magnifique|Magnifique|Nous vous présentons|Description)/i;

  const ptBlocks = [];
  for (const block of blocks) {
    if (ptBlocks.length > 0 && foreignMarkers.test(block)) {
      break;
    }
    const normalized = /[.!?:]$/.test(block) ? block : `${block}.`;
    ptBlocks.push(normalized);
    if (ptBlocks.join(' ').length >= maxLength) {
      break;
    }
  }

  const text = ptBlocks.join(' ').trim();
  if (text.length <= maxLength) return text;

  const clipped = text.slice(0, maxLength);
  // Avoid cutting on short abbreviations like "Rua D. " or "Dr. "
  let bestEnd = -1;
  for (const match of clipped.matchAll(/([a-zA-ZÀ-ÿ0-9]{4,}[.!?])\s/g)) {
    bestEnd = match.index + match[1].length;
  }
  if (bestEnd > maxLength * 0.55) {
    return clipped.slice(0, bestEnd).trim();
  }

  const lastSpace = clipped.lastIndexOf(' ');
  return `${(lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped).trim()}...`;
}

function extractIntegerSpec(value) {
  const num = Number.parseInt(value, 10);
  return Number.isFinite(num) && num > 0 && num < 1000 ? num : null;
}

function extractImages(raw, maxPhotos) {
  const candidates = Array.isArray(raw.Images) ? raw.Images : [];
  const seen = new Set();
  const urls = [];

  for (const img of candidates) {
    const url =
      img?.Thumbnail_1280x960 ||
      img?.Thumbnail_2560x1920 ||
      img?.Thumbnail_1024x768 ||
      img?.Original ||
      img?.Thumbnail;

    if (url && !seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
    if (urls.length >= maxPhotos) break;
  }

  if (urls.length === 0 && raw.Thumbnail) {
    urls.push(raw.Thumbnail);
  }

  return urls;
}

async function normalizeProperty(raw, { siteUrl, maxPhotos }) {
  const tagMap = new Map(
    (Array.isArray(raw.FeatureTags) ? raw.FeatureTags : []).map((t) => [t.Tag, t.Value])
  );

  const primaryBusiness = Array.isArray(raw.PropertyBusiness) && raw.PropertyBusiness.length > 0
    ? raw.PropertyBusiness[0]
    : null;
  const businessName = primaryBusiness?.BusinessName || 'Venda';
  const priceValue = Number(primaryBusiness?.Prices?.[0]?.PriceValue || 0);

  const bedrooms =
    extractIntegerSpec(raw.Rooms) ?? extractIntegerSpec(tagMap.get('PROPERTY_HAS_BEDROOM'));
  const bathrooms = extractIntegerSpec(raw.Bathrooms) ?? extractIntegerSpec(tagMap.get('PROPERTY_BATHROOM'));
  const garage =
    extractIntegerSpec(tagMap.get('GARAGE')) ??
    extractIntegerSpec(tagMap.get('PROPERTY_HAS_GARAGE')) ??
    extractIntegerSpec(tagMap.get('PROPERTY_NUM_PARKING_SPACES'));

  const energyRaw = (raw.EnergyCertification || '').trim();
  const energy = energyRaw && energyRaw.toLowerCase() !== 'n/a' ? energyRaw : null;

  const title = (raw.Title || `${raw.Type || 'Imóvel'} ${raw.FormattedRooms || ''}`).trim();
  const detailUrl = `${siteUrl.replace(/\/$/, '')}/imovel/${slugify(title)}/${raw.ID}`;

  const qrSvg = await QRCode.toString(detailUrl, {
    type: 'svg',
    margin: 1,
    width: 140,
    color: {
      dark: '#141414',
      light: '#FFFFFF',
    },
  });

  return {
    id: raw.ID,
    reference: raw.Reference || '',
    type: raw.Type || '',
    title,
    businessType: businessName,
    badge: formatBusinessBadge(businessName),
    priceValue,
    priceFormatted: formatPrice(priceValue, businessName),
    location: formatLocation(raw),
    specs: {
      area: formatArea(raw),
      bathrooms,
      bedrooms,
      garage,
      energy,
    },
    description: extractPortugueseDescription(raw.Description),
    images: extractImages(raw, maxPhotos),
    detailUrl,
    qrSvg,
    lastModified: raw.LastModified || null,
  };
}

/**
 * Fetches and normalizes properties from Habiestilo's website.
 */
export async function scrapeHabiestiloProperties(options = {}) {
  const siteUrl = options.siteUrl || config.siteUrl;
  const apiBaseUrl = options.apiBaseUrl || config.apiBaseUrl;
  const maxPhotos = options.maxPhotos || config.sync.maxPhotosPerProperty;
  const businessFilter = (options.businessFilter ?? config.sync.businessFilter).trim().toLowerCase();
  const limit = options.limit ?? config.sync.limit;
  const onlyWithPhotos = options.onlyWithPhotos ?? true;

  const { apiToken, requestId } = await fetchSiteCredentials(siteUrl);

  const pageSize = 50;
  let page = 1;
  let totalRecords = Infinity;
  const rawProperties = [];

  while (rawProperties.length < totalRecords) {
    const data = await fetchPropertiesPage({
      apiBaseUrl,
      siteUrl,
      apiToken,
      requestId,
      page,
      pageSize,
    });

    const batch = Array.isArray(data?.Properties) ? data.Properties : [];
    totalRecords = Number.isFinite(data?.TotalRecords) ? data.TotalRecords : batch.length;

    if (batch.length === 0) break;
    rawProperties.push(...batch);
    if (batch.length < pageSize) break;
    page += 1;
  }

  let normalized = await Promise.all(
    rawProperties.map((raw) => normalizeProperty(raw, { siteUrl, maxPhotos }))
  );

  if (onlyWithPhotos) {
    normalized = normalized.filter((p) => p.images.length > 0);
  }

  if (businessFilter) {
    normalized = normalized.filter((p) =>
      p.businessType.toLowerCase().includes(businessFilter)
    );
  }

  // Sort most recently modified first so newest listings appear prominently
  normalized.sort((a, b) => {
    const da = a.lastModified ? Date.parse(a.lastModified) : 0;
    const db = b.lastModified ? Date.parse(b.lastModified) : 0;
    return db - da;
  });

  if (limit > 0) {
    normalized = normalized.slice(0, limit);
  }

  return {
    source: siteUrl,
    syncedAt: new Date().toISOString(),
    totalFetched: rawProperties.length,
    count: normalized.length,
    properties: normalized,
  };
}
