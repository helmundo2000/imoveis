const syncBtn = document.getElementById('sync-btn');
const syncBtnLabel = document.getElementById('sync-btn-label');
const statTotal = document.getElementById('stat-total');
const statSyncedAt = document.getElementById('stat-synced-at');
const statSource = document.getElementById('stat-source');
const syncFeedback = document.getElementById('sync-feedback');

const historySelect = document.getElementById('history-select');
const diffSubtitle = document.getElementById('diff-subtitle');
const countRemoved = document.getElementById('count-removed');
const countPrice = document.getElementById('count-price');
const countAdded = document.getElementById('count-added');
const listRemoved = document.getElementById('list-removed');
const listPrice = document.getElementById('list-price');
const listAdded = document.getElementById('list-added');

const searchInput = document.getElementById('search-input');
const businessPills = document.getElementById('business-pills');
const reorderHint = document.getElementById('reorder-hint');
const propCountSub = document.getElementById('prop-count-sub');
const propertiesTbody = document.getElementById('properties-tbody');

const state = {
  properties: [],
  history: [],
  selectedHistoryIndex: 0,
  search: '',
  businessFilter: 'all',
  syncedAt: null,
  draggedId: null,
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-PT', {
    dateStyle: 'short',
    timeStyle: 'medium',
  });
}

function formatDelta(delta) {
  if (!Number.isFinite(delta) || delta === 0) return '';
  const abs = Math.abs(Math.round(delta))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return delta > 0 ? `+${abs}€` : `-${abs}€`;
}

function showFeedback(message, isError = false) {
  syncFeedback.textContent = message;
  syncFeedback.classList.toggle('is-error', isError);
  syncFeedback.classList.remove('hidden');
}

function updateActiveCountStat() {
  const activeCount = state.properties.filter((p) => p.isActive !== false).length;
  statTotal.textContent = `${activeCount} ativos / ${state.properties.length} total`;
}

function canReorder() {
  return state.businessFilter === 'all' && state.search.trim() === '';
}

function renderHistorySelector() {
  if (state.history.length === 0) {
    historySelect.innerHTML = '<option value="0">Sem registos</option>';
    historySelect.disabled = true;
    return;
  }

  historySelect.disabled = false;
  historySelect.innerHTML = state.history
    .map((entry, idx) => {
      const label = `${formatDateTime(entry.syncedAt)} (+${entry.added?.length || 0} / ~${entry.priceChanged?.length || 0} / -${entry.removed?.length || 0})`;
      return `<option value="${idx}">${escapeHtml(label)}</option>`;
    })
    .join('');
  historySelect.value = String(state.selectedHistoryIndex);
}

function renderDiff(diff) {
  if (!diff) {
    diffSubtitle.textContent =
      'Ainda não há histórico de alterações. Clique em "Sincronizar Agora" para registar.';
    countRemoved.textContent = '0';
    countPrice.textContent = '0';
    countAdded.textContent = '0';
    listRemoved.innerHTML = '<li class="diff-empty">Sem dados</li>';
    listPrice.innerHTML = '<li class="diff-empty">Sem dados</li>';
    listAdded.innerHTML = '<li class="diff-empty">Sem dados</li>';
    return;
  }

  if (diff.isInitialSync) {
    diffSubtitle.textContent = `Sincronização inicial em ${formatDateTime(diff.syncedAt)} (${diff.totalCount} imóveis carregados)`;
  } else {
    diffSubtitle.textContent = `Comparação de ${formatDateTime(diff.syncedAt)} face a ${formatDateTime(diff.previousSyncedAt)}`;
  }

  const removed = diff.removed || [];
  const priceChanged = diff.priceChanged || [];
  const added = diff.added || [];

  countRemoved.textContent = String(removed.length);
  countPrice.textContent = String(priceChanged.length);
  countAdded.textContent = String(added.length);

  listRemoved.innerHTML =
    removed.length === 0
      ? '<li class="diff-empty">Nenhum imóvel saiu nesta sincronização.</li>'
      : removed
          .map(
            (p) => `
          <li class="diff-item">
            <span class="diff-item-title">${escapeHtml(p.title)}</span>
            <span class="diff-item-meta">
              ${p.reference ? `<span>${escapeHtml(p.reference)}</span>` : ''}
              <span>${escapeHtml(p.priceFormatted)}</span>
              <span>${escapeHtml(p.location)}</span>
            </span>
          </li>`
          )
          .join('');

  listPrice.innerHTML =
    priceChanged.length === 0
      ? '<li class="diff-empty">Sem alterações de valor nesta sincronização.</li>'
      : priceChanged
          .map((p) => {
            const deltaText = formatDelta(p.deltaValue);
            return `
          <li class="diff-item">
            <span class="diff-item-title">${escapeHtml(p.title)}</span>
            <span class="diff-item-meta">
              ${p.reference ? `<span>${escapeHtml(p.reference)}</span>` : ''}
              <span class="price-old">${escapeHtml(p.oldPriceFormatted)}</span>
              <span>→</span>
              <span class="price-new">${escapeHtml(p.newPriceFormatted)}</span>
              ${deltaText ? `<span>(${escapeHtml(deltaText)})</span>` : ''}
            </span>
          </li>`;
          })
          .join('');

  listAdded.innerHTML =
    added.length === 0
      ? '<li class="diff-empty">Nenhum imóvel novo adicionado.</li>'
      : added
          .map(
            (p) => `
          <li class="diff-item">
            <span class="diff-item-title">${escapeHtml(p.title)}</span>
            <span class="diff-item-meta">
              ${p.reference ? `<span>${escapeHtml(p.reference)}</span>` : ''}
              <span>${escapeHtml(p.priceFormatted)}</span>
              <span>${escapeHtml(p.location)}</span>
            </span>
          </li>`
          )
          .join('');
}

function buildSpecsSummary(specs) {
  if (!specs) return '—';
  const parts = [];
  if (specs.area) parts.push(specs.area);
  if (specs.bedrooms) parts.push(`T${specs.bedrooms}`);
  if (specs.bathrooms) parts.push(`${specs.bathrooms} WC`);
  if (specs.garage) parts.push(`${specs.garage} Estac.`);
  if (specs.energy) parts.push(`CE ${specs.energy}`);
  return parts.join(' · ') || '—';
}

function renderPropertiesTable() {
  const latestDiff = state.history[0] || null;
  const addedIds = new Set((latestDiff?.added || []).map((p) => p.id));
  const priceIds = new Set((latestDiff?.priceChanged || []).map((p) => p.id));
  const reorderEnabled = canReorder();

  reorderHint.classList.toggle('hidden', reorderEnabled);

  const q = state.search.trim().toLowerCase();
  const filtered = state.properties.filter((p) => {
    const isActive = p.isActive !== false;
    if (state.businessFilter === 'inactive') {
      if (isActive) return false;
    } else if (state.businessFilter !== 'all') {
      if (!(p.businessType || '').toLowerCase().includes(state.businessFilter)) return false;
    }

    if (!q) return true;
    const haystack = `${p.title} ${p.reference} ${p.location} ${p.type}`.toLowerCase();
    return haystack.includes(q);
  });

  propCountSub.textContent = `A mostrar ${filtered.length} de ${state.properties.length} imóveis`;

  if (filtered.length === 0) {
    propertiesTbody.innerHTML =
      '<tr><td colspan="9" class="diff-empty">Nenhum imóvel corresponde aos filtros atuais.</td></tr>';
    return;
  }

  propertiesTbody.innerHTML = filtered
    .map((p, idx) => {
      const thumb = p.images?.[0] || '';
      const isActive = p.isActive !== false;
      const isNew = !latestDiff?.isInitialSync && addedIds.has(p.id);
      const isPriceChanged = priceIds.has(p.id);
      const fullIndex = state.properties.findIndex((item) => item.id === p.id);

      return `
      <tr
        data-id="${p.id}"
        class="${isActive ? '' : 'is-inactive'}"
        draggable="${reorderEnabled ? 'true' : 'false'}"
      >
        <td>
          <div class="order-cell">
            <span
              class="drag-handle ${reorderEnabled ? '' : 'is-disabled'}"
              title="${reorderEnabled ? 'Arraste para reordenar' : 'Limpe filtros para reordenar'}"
              aria-hidden="true"
            >⋮⋮</span>
            <span class="order-num">#${fullIndex + 1}</span>
            <div class="order-arrows">
              <button
                type="button"
                class="order-btn"
                data-action="move-up"
                data-id="${p.id}"
                title="Subir na ordem"
                ${!reorderEnabled || idx === 0 ? 'disabled' : ''}
              >▲</button>
              <button
                type="button"
                class="order-btn"
                data-action="move-down"
                data-id="${p.id}"
                title="Descer na ordem"
                ${!reorderEnabled || idx === filtered.length - 1 ? 'disabled' : ''}
              >▼</button>
            </div>
          </div>
        </td>
        <td>
          <button
            type="button"
            class="status-toggle ${isActive ? 'is-active' : 'is-inactive'}"
            data-action="toggle-status"
            data-id="${p.id}"
            aria-pressed="${isActive ? 'true' : 'false'}"
          >
            <span class="status-dot"></span>
            <span>${isActive ? 'Ativo' : 'Inativo'}</span>
          </button>
        </td>
        <td>
          <div class="prop-cell">
            <img class="prop-thumb" src="${escapeHtml(thumb)}" alt="" loading="lazy" />
            <div>
              <a class="prop-link" href="${escapeHtml(p.detailUrl)}" target="_blank" rel="noopener">
                ${escapeHtml(p.title)}
              </a>
              <div class="prop-type-sub">${escapeHtml(p.type || 'Imóvel')}</div>
            </div>
          </div>
        </td>
        <td>
          <span class="ref-code">${escapeHtml(p.reference || String(p.id))}</span>
          <div class="tag-row">
            ${isNew ? '<span class="mini-tag is-new">Novo</span>' : ''}
            ${isPriceChanged ? '<span class="mini-tag is-price">Valor alterado</span>' : ''}
          </div>
        </td>
        <td>${escapeHtml(p.location)}</td>
        <td>${escapeHtml(p.businessType)}</td>
        <td class="price-cell">${escapeHtml(p.priceFormatted)}</td>
        <td class="specs-summary">${escapeHtml(buildSpecsSummary(p.specs))}</td>
        <td>${p.images?.length || 0}</td>
      </tr>`;
    })
    .join('');
}

async function persistOrder() {
  const order = state.properties.map((p) => p.id);
  const res = await fetch('/api/properties/order', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  showFeedback('Ordem de exibição guardada e aplicada ao signage.');
}

async function moveProperty(id, direction) {
  const index = state.properties.findIndex((p) => p.id === id);
  if (index === -1) return;
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= state.properties.length) return;

  const [moved] = state.properties.splice(index, 1);
  state.properties.splice(targetIndex, 0, moved);
  renderPropertiesTable();

  try {
    await persistOrder();
  } catch (err) {
    showFeedback(`Erro ao guardar ordem: ${err.message}`, true);
    await loadDashboardData();
  }
}

async function reorderPropertyBefore(sourceId, targetId) {
  if (sourceId === targetId) return;
  const fromIdx = state.properties.findIndex((p) => p.id === sourceId);
  const toIdx = state.properties.findIndex((p) => p.id === targetId);
  if (fromIdx === -1 || toIdx === -1) return;

  const [moved] = state.properties.splice(fromIdx, 1);
  state.properties.splice(toIdx, 0, moved);
  renderPropertiesTable();

  try {
    await persistOrder();
  } catch (err) {
    showFeedback(`Erro ao guardar ordem: ${err.message}`, true);
    await loadDashboardData();
  }
}

async function togglePropertyStatus(id, buttonEl) {
  const prop = state.properties.find((p) => p.id === id);
  if (!prop) return;

  const nextActive = prop.isActive === false;
  if (buttonEl) buttonEl.disabled = true;

  try {
    const res = await fetch(`/api/properties/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: nextActive }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    prop.isActive = nextActive;
    updateActiveCountStat();
    renderPropertiesTable();
    showFeedback(
      nextActive
        ? `Imóvel "${prop.reference || prop.title}" ativado no signage.`
        : `Imóvel "${prop.reference || prop.title}" inativado (oculto do signage).`
    );
  } catch (err) {
    showFeedback(`Erro ao atualizar estado: ${err.message}`, true);
  } finally {
    if (buttonEl) buttonEl.disabled = false;
  }
}

async function loadDashboardData() {
  const [propRes, histRes] = await Promise.all([
    fetch('/api/properties?includeInactive=1', { cache: 'no-store' }),
    fetch('/api/sync-history', { cache: 'no-store' }),
  ]);

  const propData = await propRes.json();
  const histData = await histRes.json();

  state.properties = propData.properties || [];
  state.syncedAt = propData.syncedAt || null;
  state.history = histData.history || (propData.lastDiff ? [propData.lastDiff] : []);
  state.selectedHistoryIndex = 0;

  updateActiveCountStat();
  statSyncedAt.textContent = formatDateTime(state.syncedAt);
  statSource.textContent = (propData.source || 'https://www.habiestilo.com').replace(
    /^https?:\/\//,
    ''
  );

  renderHistorySelector();
  renderDiff(state.history[state.selectedHistoryIndex] || null);
  renderPropertiesTable();
}

async function handleManualSync() {
  syncBtn.disabled = true;
  syncBtn.classList.add('is-loading');
  syncBtnLabel.textContent = 'A sincronizar...';
  syncFeedback.classList.add('hidden');

  try {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const result = await res.json();
    if (!res.ok || !result.ok) {
      throw new Error(result.error || `HTTP ${res.status}`);
    }

    await loadDashboardData();

    const d = result.diff;
    showFeedback(
      `Sincronizado (${result.count} imóveis): ${d.added.length} adicionados, ${d.priceChanged.length} alteração de valor, ${d.removed.length} saíram.`
    );
  } catch (err) {
    showFeedback(`Erro ao sincronizar: ${err.message}`, true);
  } finally {
    syncBtn.disabled = false;
    syncBtn.classList.remove('is-loading');
    syncBtnLabel.textContent = 'Sincronizar Agora';
  }
}

syncBtn.addEventListener('click', handleManualSync);

historySelect.addEventListener('change', (e) => {
  state.selectedHistoryIndex = Number.parseInt(e.target.value, 10) || 0;
  renderDiff(state.history[state.selectedHistoryIndex] || null);
});

searchInput.addEventListener('input', (e) => {
  state.search = e.target.value;
  renderPropertiesTable();
});

businessPills.addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-pill');
  if (!btn) return;
  for (const el of businessPills.querySelectorAll('.filter-pill')) {
    el.classList.remove('is-active');
  }
  btn.classList.add('is-active');
  state.businessFilter = btn.dataset.filter || 'all';
  renderPropertiesTable();
});

propertiesTbody.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const action = btn.dataset.action;

  if (action === 'toggle-status') {
    togglePropertyStatus(id, btn);
  } else if (action === 'move-up') {
    moveProperty(id, -1);
  } else if (action === 'move-down') {
    moveProperty(id, 1);
  }
});

propertiesTbody.addEventListener('dragstart', (e) => {
  if (!canReorder()) {
    e.preventDefault();
    return;
  }
  const row = e.target.closest('tr[data-id]');
  if (!row) return;
  state.draggedId = Number(row.dataset.id);
  row.classList.add('is-dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(state.draggedId));
});

propertiesTbody.addEventListener('dragover', (e) => {
  if (!canReorder() || state.draggedId === null) return;
  const row = e.target.closest('tr[data-id]');
  if (!row) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  for (const el of propertiesTbody.querySelectorAll('.is-drag-over')) {
    if (el !== row) el.classList.remove('is-drag-over');
  }
  if (Number(row.dataset.id) !== state.draggedId) {
    row.classList.add('is-drag-over');
  }
});

propertiesTbody.addEventListener('drop', (e) => {
  if (!canReorder() || state.draggedId === null) return;
  const row = e.target.closest('tr[data-id]');
  if (!row) return;
  e.preventDefault();
  const targetId = Number(row.dataset.id);
  const sourceId = state.draggedId;
  state.draggedId = null;
  reorderPropertyBefore(sourceId, targetId);
});

propertiesTbody.addEventListener('dragend', () => {
  state.draggedId = null;
  for (const el of propertiesTbody.querySelectorAll('.is-dragging, .is-drag-over')) {
    el.classList.remove('is-dragging', 'is-drag-over');
  }
});

loadDashboardData();
