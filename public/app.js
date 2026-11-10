(function () {
  'use strict';

  var stageEl = document.getElementById('signage-stage');
  var priceEl = document.getElementById('prop-price');
  var badgeEl = document.getElementById('prop-badge');
  var titleEl = document.getElementById('prop-title');
  var locationEl = document.getElementById('prop-location');
  var specsEl = document.getElementById('prop-specs');
  var descEl = document.getElementById('prop-description');
  var qrEl = document.getElementById('prop-qr');
  var emptyEl = document.getElementById('empty-state');
  var layerA = document.getElementById('photo-layer-a');
  var layerB = document.getElementById('photo-layer-b');

  var ICONS = {
    area:
      '<svg viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">' +
      '<path d="M32 10 8 30h7v23h12V39h10v14h12V30h7L32 10z"/>' +
      '</svg>',
    bathrooms:
      '<svg viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">' +
      '<path d="M15 29v-9a7 7 0 0 1 14 0v2h-4v-2a3 3 0 0 0-6 0v9h34a3 3 0 0 1 3 3c0 8.2-4.8 14.5-12 16.5V53h-4v-3.7c-1.3.2-2.6.2-4 .2H23c-1.4 0-2.7 0-4-.2V53h-4v-4.5C7.8 46.5 3 40.2 3 32a3 3 0 0 1 3-3h9zm10-9a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/>' +
      '<circle cx="25" cy="25" r="1.4"/><circle cx="29" cy="26" r="1.4"/><circle cx="27" cy="28.5" r="1.4"/>' +
      '</svg>',
    bedrooms:
      '<svg viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">' +
      '<path d="M10 18a4 4 0 0 1 4-4h36a4 4 0 0 1 4 4v13H10V18zm5 3v6h15v-6H15zm19 0v6h15v-6H34zM6 34h52a3 3 0 0 1 3 3v11h-5v-4H8v4H3V37a3 3 0 0 1 3-3z"/>' +
      '</svg>',
    garage:
      '<svg viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">' +
      '<path d="M18 16h28l6 14h2a3 3 0 0 1 3 3v14h-6v4h-6v-4H19v4h-6v-4H7V33a3 3 0 0 1 3-3h2l6-14zm2.6 4-4 10h30.8l-4-10H20.6zM16 36a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm32 0a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"/>' +
      '</svg>',
    energy: function (rating) {
      var safeRating = escapeHtml(rating || 'A+');
      var fontSize = safeRating.length > 2 ? 12 : 15;
      return (
        '<svg viewBox="0 0 64 64" fill="none" aria-hidden="true">' +
        '<path d="M32 10 10 27v24a3 3 0 0 0 3 3h38a3 3 0 0 0 3-3V27L32 10z" ' +
        'stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>' +
        '<text x="32" y="42" text-anchor="middle" fill="currentColor" ' +
        'font-family="Montserrat, Arial, sans-serif" font-weight="600" font-size="' +
        fontSize +
        '">' +
        safeRating +
        '</text></svg>'
      );
    },
  };

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function parseQueryParams() {
    var result = {};
    var search = window.location.search || '';
    if (search.charAt(0) === '?') search = search.slice(1);
    if (!search) return result;
    var parts = search.split('&');
    for (var i = 0; i < parts.length; i += 1) {
      var kv = parts[i].split('=');
      if (!kv[0]) continue;
      result[decodeURIComponent(kv[0])] = decodeURIComponent(kv.slice(1).join('=') || '');
    }
    return result;
  }

  var query = parseQueryParams();
  var parsedPropMs = parseInt(query.propertyMs || '', 10);
  var parsedPhotoMs = parseInt(query.photoMs || '', 10);
  var parsedRotate = parseInt(query.rotate || '0', 10);

  var overrides = {
    propertyMs: !isNaN(parsedPropMs) && parsedPropMs >= 3000 ? parsedPropMs : null,
    photoMs: !isNaN(parsedPhotoMs) && parsedPhotoMs >= 1500 ? parsedPhotoMs : null,
    filter: (query.filter || '').replace(/^\s+|\s+$/g, '').toLowerCase(),
    rotate: parsedRotate === 90 || parsedRotate === 180 || parsedRotate === 270 ? parsedRotate : 0,
  };

  var state = {
    config: {
      propertyDurationMs: 25000,
      photoDurationMs: 5000,
      photoFadeMs: 1000,
      pollIntervalMs: 30000,
    },
    properties: [],
    pendingProperties: null,
    version: null,
    propertyIndex: 0,
    photoIndex: 0,
    activeLayer: 'a',
    paused: false,
    propertyTimer: null,
    photoTimer: null,
    isTransitioning: false,
  };

  /* Scales the 1080x1920 virtual stage cleanly on Tizen 4.0 / Chrome 56 / Xopvision zones */
  function updateStageScale() {
    var vw = window.innerWidth || document.documentElement.clientWidth || 1080;
    var vh = window.innerHeight || document.documentElement.clientHeight || 1920;
    var rotated = overrides.rotate === 90 || overrides.rotate === 270;
    var targetW = rotated ? 1920 : 1080;
    var targetH = rotated ? 1080 : 1920;
    var scale = Math.min(vw / targetW, vh / targetH);
    var transformValue =
      'scale(' + scale.toFixed(6) + ')' +
      (overrides.rotate ? ' rotate(' + overrides.rotate + 'deg)' : '');
    stageEl.style.webkitTransform = transformValue;
    stageEl.style.transform = transformValue;
  }

  function requestJson(url) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.setRequestHeader('Cache-Control', 'no-cache');
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (err) {
            reject(err);
          }
        } else {
          reject(new Error('HTTP ' + xhr.status));
        }
      };
      xhr.onerror = function () {
        reject(new Error('Network error'));
      };
      xhr.send();
    });
  }

  function preloadImage(url) {
    if (!url) return Promise.resolve();
    return new Promise(function (resolve) {
      var done = false;
      var finish = function () {
        if (done) return;
        done = true;
        resolve();
      };
      var img = new Image();
      img.onload = finish;
      img.onerror = finish;
      img.src = url;
      setTimeout(finish, 4000);
    });
  }

  function buildSpecsHtml(specs) {
    var items = [];
    if (specs && specs.area) {
      items.push({ icon: ICONS.area, label: specs.area });
    }
    if (specs && specs.bathrooms) {
      items.push({ icon: ICONS.bathrooms, label: String(specs.bathrooms) });
    }
    if (specs && specs.bedrooms) {
      items.push({ icon: ICONS.bedrooms, label: String(specs.bedrooms) });
    }
    if (specs && specs.garage) {
      items.push({ icon: ICONS.garage, label: String(specs.garage) });
    }
    if (specs && specs.energy) {
      items.push({ icon: ICONS.energy(specs.energy), label: 'Classe Energética' });
    }

    if (items.length > 0 && items.length < 4) {
      specsEl.classList.add('is-compact');
    } else {
      specsEl.classList.remove('is-compact');
    }

    var html = '';
    for (var i = 0; i < items.length; i += 1) {
      html +=
        '<div class="spec-item">' +
        '<div class="spec-icon">' + items[i].icon + '</div>' +
        '<div class="spec-value">' + escapeHtml(items[i].label) + '</div>' +
        '</div>';
    }
    return html;
  }

  function showPhoto(url, immediate) {
    var incoming = state.activeLayer === 'a' ? layerB : layerA;
    var outgoing = state.activeLayer === 'a' ? layerA : layerB;

    if (immediate) {
      incoming.style.webkitTransition = 'none';
      incoming.style.transition = 'none';
    } else {
      incoming.style.webkitTransition = '';
      incoming.style.transition = '';
    }

    incoming.classList.remove('is-active');
    incoming.classList.remove('is-exiting');
    incoming.src = url || '';

    void incoming.offsetWidth;
    if (immediate) {
      incoming.style.webkitTransition = '';
      incoming.style.transition = '';
    }

    outgoing.classList.remove('is-active');
    outgoing.classList.add('is-exiting');
    incoming.classList.add('is-active');

    state.activeLayer = state.activeLayer === 'a' ? 'b' : 'a';
  }

  function scheduleNextPhoto() {
    clearTimeout(state.photoTimer);
    if (state.paused || state.properties.length === 0) return;

    var prop = state.properties[state.propertyIndex];
    var images = prop && prop.images ? prop.images : [];
    if (images.length <= 1) return;

    var nextIdx = (state.photoIndex + 1) % images.length;
    preloadImage(images[nextIdx]);

    state.photoTimer = setTimeout(function () {
      state.photoIndex = nextIdx;
      preloadImage(images[state.photoIndex]).then(function () {
        showPhoto(images[state.photoIndex], false);
        scheduleNextPhoto();
      });
    }, state.config.photoDurationMs);
  }

  function scheduleNextProperty() {
    clearTimeout(state.propertyTimer);
    if (state.paused || state.properties.length <= 1) return;

    var nextIdx = (state.propertyIndex + 1) % state.properties.length;
    var nextProp = state.properties[nextIdx];
    if (nextProp && nextProp.images && nextProp.images[0]) {
      preloadImage(nextProp.images[0]);
    }

    state.propertyTimer = setTimeout(function () {
      transitionToProperty(nextIdx, false);
    }, state.config.propertyDurationMs);
  }

  function renderPropertyContent(prop) {
    var priceText = prop.priceFormatted || 'Sob Consulta';
    priceEl.textContent = priceText;
    priceEl.classList.toggle('is-long', priceText.length >= 10 && priceText !== 'Sob Consulta');
    priceEl.classList.toggle('is-consult', priceText === 'Sob Consulta');

    var badgePt = prop.badge && prop.badge.pt ? prop.badge.pt : 'PARA VENDA';
    var badgeEn = prop.badge && prop.badge.en ? prop.badge.en : '';
    var enHtml = badgeEn
      ? '<span class="badge-sep"></span><span>' + escapeHtml(badgeEn) + '</span>'
      : '';
    badgeEl.innerHTML = '<span>' + escapeHtml(badgePt) + '</span>' + enHtml;

    titleEl.textContent = prop.title || '';
    locationEl.textContent = prop.location || '';
    specsEl.innerHTML = buildSpecsHtml(prop.specs);
    descEl.textContent = prop.description || '';
    qrEl.innerHTML = prop.qrSvg || '';
  }

  function transitionToProperty(targetIndex, immediate) {
    if (state.isTransitioning || state.properties.length === 0) return Promise.resolve();
    state.isTransitioning = true;
    clearTimeout(state.photoTimer);
    clearTimeout(state.propertyTimer);

    if (state.pendingProperties) {
      state.properties = state.pendingProperties;
      state.pendingProperties = null;
      targetIndex = targetIndex % state.properties.length;
    }

    var leavePromise = immediate
      ? Promise.resolve()
      : new Promise(function (resolve) {
          stageEl.classList.remove('is-visible');
          stageEl.classList.add('is-leaving');
          setTimeout(resolve, 340);
        });

    return leavePromise.then(function () {
      state.propertyIndex = (targetIndex + state.properties.length) % state.properties.length;
      state.photoIndex = 0;

      var prop = state.properties[state.propertyIndex];
      var firstImg = prop.images && prop.images[0] ? prop.images[0] : '';

      return preloadImage(firstImg).then(function () {
        renderPropertyContent(prop);
        showPhoto(firstImg, true);

        stageEl.classList.remove('is-leaving');
        void stageEl.offsetWidth;
        stageEl.classList.add('is-visible');

        state.isTransitioning = false;
        scheduleNextPhoto();
        scheduleNextProperty();
      });
    });
  }

  function filterProperties(list) {
    if (!overrides.filter) return list;
    var filtered = [];
    for (var i = 0; i < list.length; i += 1) {
      var p = list[i];
      var bType = (p.businessType || '').toLowerCase();
      var pType = (p.type || '').toLowerCase();
      if (bType.indexOf(overrides.filter) !== -1 || pType.indexOf(overrides.filter) !== -1) {
        filtered.push(p);
      }
    }
    return filtered.length > 0 ? filtered : list;
  }

  function pollForUpdates() {
    var cacheBust = '?_t=' + Date.now();
    return requestJson('/api/properties' + cacheBust)
      .then(function (data) {
        var list = filterProperties(data.properties || []);

        if (list.length === 0) {
          state.properties = [];
          state.pendingProperties = null;
          state.version = data.version || data.syncedAt || null;
          clearTimeout(state.photoTimer);
          clearTimeout(state.propertyTimer);
          emptyEl.classList.remove('hidden');
          return;
        }

        emptyEl.classList.add('hidden');
        var nextVersion = data.version || data.syncedAt || null;

        if (state.properties.length === 0) {
          state.version = nextVersion;
          state.properties = list;
          return transitionToProperty(0, true);
        }

        if (nextVersion && nextVersion !== state.version) {
          state.version = nextVersion;
          state.pendingProperties = list;
        }
      })
      .catch(function (err) {
        if (window.console && console.warn) {
          console.warn('[signage] Falha ao verificar atualizações:', err.message);
        }
      });
  }

  function setupKioskInteractions() {
    var idleTimer = null;
    var resetIdle = function () {
      document.body.classList.remove('kiosk-idle');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(function () {
        document.body.classList.add('kiosk-idle');
      }, 3000);
    };
    window.addEventListener('mousemove', resetIdle);
    resetIdle();

    window.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.keyCode === 39) {
        transitionToProperty(state.propertyIndex + 1, false);
      } else if (e.key === 'ArrowLeft' || e.keyCode === 37) {
        transitionToProperty(state.propertyIndex - 1, false);
      } else if (e.key === ' ' || e.keyCode === 32) {
        e.preventDefault();
        state.paused = !state.paused;
        if (!state.paused) {
          scheduleNextPhoto();
          scheduleNextProperty();
        } else {
          clearTimeout(state.photoTimer);
          clearTimeout(state.propertyTimer);
        }
      }
    });
  }

  function init() {
    updateStageScale();
    window.addEventListener('resize', updateStageScale);
    setupKioskInteractions();

    requestJson('/api/config?_t=' + Date.now())
      .then(function (serverCfg) {
        if (serverCfg) {
          if (serverCfg.propertyDurationMs) {
            state.config.propertyDurationMs = serverCfg.propertyDurationMs;
          }
          if (serverCfg.photoDurationMs) {
            state.config.photoDurationMs = serverCfg.photoDurationMs;
          }
          if (serverCfg.photoFadeMs) {
            state.config.photoFadeMs = serverCfg.photoFadeMs;
          }
          if (serverCfg.pollIntervalMs) {
            state.config.pollIntervalMs = serverCfg.pollIntervalMs;
          }
        }
      })
      .catch(function () {
        /* Fallback to default timings */
      })
      .then(function () {
        if (overrides.propertyMs) state.config.propertyDurationMs = overrides.propertyMs;
        if (overrides.photoMs) state.config.photoDurationMs = overrides.photoMs;

        document.documentElement.style.setProperty(
          '--photo-fade-ms',
          state.config.photoFadeMs + 'ms'
        );

        return pollForUpdates();
      })
      .then(function () {
        setInterval(pollForUpdates, state.config.pollIntervalMs);
      });
  }

  init();
})();
