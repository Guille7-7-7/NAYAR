// ═══════════════════════════════════════════════════════════════════════════
// NAYAR · Oficinas & Coworking · Dashboard JS
// Fusión de javascript(5).js (lógica ThingSpeak probada) +
// coworking.js (zonas, tendencia semanal, tiempo de estancia)
// ═══════════════════════════════════════════════════════════════════════════

// ── MAPEO DE FIELDS THINGSPEAK ────────────────────────────────────────────
const FIELD_MAP = {
  field1: { label: 'Distancia media',   kpi: 'kpiRssi',      unit: ' m'  },
  field2: { label: 'Dispositivos',      kpi: 'kpiDevices',   unit: ''    },
  field3: { label: 'Ocupación',         kpi: 'kpiOccupancy', unit: '%'   },
  field4: { label: 'Móviles',           kpi: null,           unit: ''    },
  field5: { label: 'Portátiles',        kpi: null,           unit: ''    },
  field6: { label: 'IoT / Smart',       kpi: null,           unit: ''    },
  field7: { label: 'Otros',             kpi: null,           unit: ''    },
  field8: { label: 'Alertas Activas',   kpi: null,           unit: ''    },
};

// ── ESTADO ────────────────────────────────────────────────────────────────
let pollingTimer  = null;
let prevValues    = {};
let historyRssi   = [];
let historyDevs   = [];
let historyTimes  = [];

// ── CONVERSIÓN RSSI → METROS ──────────────────────────────────────────────
// Modelo log-distance: d = 10 ^ ((TxPower - RSSI) / (10 * n))
// TxPower ≈ -40 dBm a 1 m, n = 2.0 (espacio abierto interior)
function rssiToMetros(rssi) {
  const txPower = -40;
  const n       = 2.0;
  if (!rssi || isNaN(rssi)) return null;
  const metros = Math.pow(10, (txPower - rssi) / (10 * n));
  return Math.max(0.1, Math.min(metros, 99.9));
}

// Estima tiempo medio de estancia (min) a partir de la distancia media y
// la densidad de dispositivos — cuanto más cerca y más gente, más tiempo
function estimarDwell(metros, devices) {
  if (!metros || !devices) return null;
  const base   = 12 + devices * 0.8;
  const factor = Math.max(0.5, 1 - (metros / 20));
  return Math.round(base * factor);
}

// ── HELPER DOM ────────────────────────────────────────────────────────────
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ── ERROR BANNER ──────────────────────────────────────────────────────────
function showError(msg) {
  const b = document.getElementById('errorBanner');
  if (!b) return;
  b.textContent   = '⚠ ' + msg;
  b.style.display = 'flex';
}

function hideError() {
  const b = document.getElementById('errorBanner');
  if (!b) return;
  b.textContent   = '';
  b.style.display = 'none';
}

// ── ESTADO CONEXIÓN ───────────────────────────────────────────────────────
function setOnline() {
  const dot   = document.getElementById('statusDot');
  const label = document.getElementById('statusLabel');
  if (dot)   dot.className     = 'status-dot online';
  if (label) label.textContent = 'En línea';
}

function setOffline() {
  const dot   = document.getElementById('statusDot');
  const label = document.getElementById('statusLabel');
  if (dot)   dot.className     = 'status-dot offline';
  if (label) label.textContent = 'Sin conexión';
}

// ── FETCH THINGSPEAK ──────────────────────────────────────────────────────
async function fetchThingSpeak() {
  const channelId = document.getElementById('channelId').value.trim();
  const apiKey    = document.getElementById('apiKey').value.trim();

  if (!channelId) {
    showError('Introduce un Canal ID antes de conectar.');
    return;
  }

  const url = `https://api.thingspeak.com/channels/${channelId}/feeds.json?results=30${apiKey ? '&api_key=' + apiKey : ''}`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Error HTTP ${resp.status}`);
    const data = await resp.json();

    if (!data.feeds || data.feeds.length === 0) {
      showError('Canal encontrado pero sin datos. ¿La Raspberry está enviando?');
      setOffline();
      return;
    }

    hideError();
    applyData(data);
    setOnline();

    const now = new Date().toLocaleTimeString('es-ES');
    setText('lastUpdate', 'Actualizado: ' + now);

    const footerCh = document.getElementById('footerChannel');
    if (footerCh) footerCh.textContent = 'Canal: ' + (data.channel.name || channelId);

  } catch (err) {
    showError('No se pudo conectar con ThingSpeak: ' + err.message);
    setOffline();
  }
}

// ── APLICAR DATOS ─────────────────────────────────────────────────────────
function applyData(data) {
  const feeds  = data.feeds;
  const latest = feeds[feeds.length - 1];

  // ── KPI: Dispositivos (field2)
  const rawDevices = parseFloat(latest.field2);
  if (!isNaN(rawDevices)) {
    setText('kpiDevices', Math.round(rawDevices));
    updateTrend('field2', rawDevices, prevValues.field2);
    prevValues.field2 = rawDevices;
  }

  // ── KPI: Distancia media RSSI → metros (field1)
  const rawRssi = parseFloat(latest.field1);
  const metros  = rssiToMetros(rawRssi);
  if (metros !== null) {
    updateTrend('field1', metros, prevValues.field1);
    prevValues.field1 = metros;
  }

  // ── KPI: Ocupación (field3)
  const rawOcc = parseFloat(latest.field3);
  if (!isNaN(rawOcc)) {
    setText('kpiOccupancy', Math.round(rawOcc) + '%');
    updateTrend('field3', rawOcc, prevValues.field3);
    prevValues.field3 = rawOcc;
  }

  // ── KPI: Tiempo medio de estancia (calculado desde field1 + field2)
  const dwell = estimarDwell(metros, isNaN(rawDevices) ? 0 : rawDevices);
  if (dwell !== null) setText('kpiDwell', dwell + ' min');

  // ── Tipos de dispositivos (fields 4–7)
  renderDeviceTypes(latest);

  // ── Ocupación por zona (distribuida desde field2)
  const totalDev = isNaN(rawDevices) ? 0 : rawDevices;
  const ts = new Date(latest.created_at)
    .toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  updateZone('z1', Math.round(totalDev * 0.40), 30, ts);
  updateZone('z2', Math.round(totalDev * 0.20), 10, ts);
  updateZone('z3', Math.round(totalDev * 0.25), 20, ts);
  updateZone('z4', Math.round(totalDev * 0.15), 15, ts);

  // ── Tendencia semanal (barras L–D)
  const occ = isNaN(rawOcc) ? 0 : Math.round(rawOcc);
  renderWeeklyTrend(occ);

  // ── Historial para gráficas
  historyTimes = feeds.map(f => {
    const d = new Date(f.created_at);
    return String(d.getHours()).padStart(2, '0') + ':' +
           String(d.getMinutes()).padStart(2, '0');
  });

  historyRssi = feeds.map(f => {
    const m = rssiToMetros(parseFloat(f.field1));
    return m !== null ? parseFloat(m.toFixed(1)) : 0;
  });
  historyDevs = feeds.map(f => parseFloat(f.field2) || 0);

  drawLineChart('rssiChart', historyRssi, historyTimes, '#6f17e2', 'gradRssi', null);
  drawBarChart ('devChart',  historyDevs, historyTimes, '#0d9065');

  setText('chartPoints',   feeds.length + ' datos');
  setText('devChartBadge', 'Máx: ' + Math.max(...historyDevs));
}

// ── TIPOS DE DISPOSITIVOS ─────────────────────────────────────────────────
function renderDeviceTypes(latest) {
  const mobile = parseFloat(latest.field4) || 0;
  const laptop = parseFloat(latest.field5) || 0;
  const iot    = parseFloat(latest.field6) || 0;
  const other  = parseFloat(latest.field7) || 0;
  const total  = mobile + laptop + iot + other || 1;

  [
    { id: 'Mobile', val: mobile },
    { id: 'Laptop', val: laptop },
    { id: 'Iot',    val: iot    },
    { id: 'Other',  val: other  },
  ].forEach(({ id, val }) => {
    const pct = Math.round((val / total) * 100);
    setText('dev' + id,         Math.round(val));
    setText('dev' + id + 'Pct', pct + '% del total');
    const bar = document.getElementById('dev' + id + 'Bar');
    if (bar) bar.style.width = pct + '%';
  });
}

// ── OCUPACIÓN POR ZONA ────────────────────────────────────────────────────
function updateZone(id, count, maxCount, ts) {
  const pct = Math.round(count / maxCount * 100);
  setText(id + 'dev',  count + ' disp.');
  setText(id + 'pct',  pct + '%');
  setText(id + 'time', ts);

  const bar = document.getElementById(id + 'bar');
  if (bar) bar.style.width = Math.min(pct, 100) + '%';

  const st = document.getElementById(id + 'status');
  if (!st) return;
  if (pct < 60)      { st.textContent = '● Disponible'; st.className = 'badge-ok';   }
  else if (pct < 85) { st.textContent = '◐ Moderado';   st.className = 'badge-warn'; }
  else               { st.textContent = '● Completo';    st.className = 'badge-full'; }
}

// ── TENDENCIA SEMANAL ─────────────────────────────────────────────────────
function renderWeeklyTrend(occ) {
  const today    = new Date().getDay();          // 0=Dom … 6=Sab
  const todayIdx = today === 0 ? 6 : today - 1; // 0=Lun … 6=Dom
  const weekOcc  = [72, 68, 81, 75, 88, 42, 30];
  weekOcc[todayIdx] = occ;

  const maxDay = Math.max(...weekOcc);
  weekOcc.forEach((v, i) => {
    const bar = document.getElementById('wb' + i);
    const val = document.getElementById('wv' + i);
    if (bar) bar.style.height = Math.round(v / maxDay * 100) + '%';
    if (val) val.textContent  = v + '%';
  });

  setText('trendWeekly', occ > 70 ? '↑ Alta demanda' : occ > 40 ? '→ Uso moderado' : '↓ Baja ocupación');
  setText('trendSaving',  occ < 60 ? '−' + Math.round((60 - occ) * 0.8) + '% costes' : 'Espacio optimizado');
}

// ── TENDENCIAS KPI ────────────────────────────────────────────────────────
function updateTrend(field, current, prev) {
  const map = {
    field1: null,           // metros → no hay elemento propio en el HTML
    field2: 'trendDevices',
    field3: 'trendOcc',
  };
  const elId = map[field];
  if (!elId) return;
  const el = document.getElementById(elId);
  if (!el || prev === undefined) return;
  const diff = parseFloat((current - prev).toFixed(1));
  if      (diff > 0) el.textContent = '▲ +' + diff;
  else if (diff < 0) el.textContent = '▼ '  + diff;
  else               el.textContent = '— sin cambio';
}

// ── GRÁFICA DE LÍNEA ──────────────────────────────────────────────────────
function drawLineChart(svgId, values, labels, color, gradId, yRange) {
  const svg = document.getElementById(svgId);
  if (!svg || values.length < 2) return;

  const W = 600, H = 180;
  const p = { t: 10, b: 30, l: 10, r: 10 };
  const min    = yRange ? yRange[0] : Math.min(...values) - 1;
  const max    = yRange ? yRange[1] : Math.max(...values) + 1;
  const xStep  = (W - p.l - p.r) / (values.length - 1);
  const yScale = v => p.t + (H - p.t - p.b) * (1 - (v - min) / ((max - min) || 1));
  const pts    = values.map((v, i) => `${p.l + i * xStep},${yScale(v)}`).join(' ');
  const area   = `${p.l + (values.length - 1) * xStep},${H - p.b} ${p.l},${H - p.b}`;

  let ticks = '';
  values.forEach((v, i) => {
    if (i % 5 === 0)
      ticks += `<text x="${p.l + i * xStep}" y="${H - 8}" text-anchor="middle"
                      fill="rgba(14,14,18,0.35)" font-family="DM Mono,monospace" font-size="8">
                  ${labels[i] || ''}
                </text>`;
  });

  svg.innerHTML = `
    <defs>
      <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="${color}" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${[0.25, 0.5, 0.75].map(f =>
      `<line x1="${p.l}" y1="${p.t + (H - p.t - p.b) * f}"
             x2="${W - p.r}" y2="${p.t + (H - p.t - p.b) * f}"
             stroke="rgba(14,14,18,0.07)" stroke-width="1" stroke-dasharray="4,4"/>`
    ).join('')}
    <polygon points="${pts} ${area}" fill="url(#${gradId})"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round"/>
    ${values.map((v, i) =>
      `<circle cx="${p.l + i * xStep}" cy="${yScale(v)}" r="2.5" fill="${color}" opacity="0.75"/>`
    ).join('')}
    ${ticks}
    <text x="${W - p.r - 4}" y="${yScale(values[values.length - 1]) - 8}"
          text-anchor="end" fill="${color}"
          font-family="DM Mono,monospace" font-size="10" font-weight="bold">
      ${values[values.length - 1].toFixed(1)} m
    </text>
  `;
}

// ── GRÁFICA DE BARRAS ─────────────────────────────────────────────────────
function drawBarChart(svgId, values, labels, color) {
  const svg = document.getElementById(svgId);
  if (!svg || values.length < 1) return;

  const W = 600, H = 180;
  const p = { t: 10, b: 30, l: 10, r: 10 };
  const max  = Math.max(...values, 1);
  const gap  = (W - p.l - p.r) / values.length;
  const barW = gap * 0.7;
  let bars   = '';

  values.forEach((v, i) => {
    const bH = (v / max) * (H - p.t - p.b);
    const x  = p.l + i * gap + (gap - barW) / 2;
    bars += `<rect x="${x}" y="${H - p.b - bH}" width="${barW}" height="${bH}"
                   fill="${color}" opacity="${0.35 + (v / max) * 0.65}" rx="2"/>`;
    if (i % 5 === 0)
      bars += `<text x="${x + barW / 2}" y="${H - 8}" text-anchor="middle"
                     fill="rgba(14,14,18,0.35)" font-family="DM Mono,monospace" font-size="8">
                 ${labels[i] || ''}
               </text>`;
  });

  svg.innerHTML = `
    ${[0.25, 0.5, 0.75, 1].map(f => {
      const y = p.t + (H - p.t - p.b) * (1 - f);
      return `<line x1="${p.l}" y1="${y}" x2="${W - p.r}" y2="${y}"
                    stroke="rgba(14,14,18,0.07)" stroke-width="1" stroke-dasharray="4,4"/>
              <text x="${p.l + 2}" y="${y - 3}"
                    fill="rgba(14,14,18,0.35)" font-family="DM Mono,monospace" font-size="8">
                ${Math.round(max * f)}
              </text>`;
    }).join('')}
    ${bars}
  `;
}

// ── POLLING ───────────────────────────────────────────────────────────────
function startPolling() {
  stopPolling();
  fetchThingSpeak();
  pollingTimer = setInterval(fetchThingSpeak, 30000);
}

function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
  setOffline();
  setText('lastUpdate', '');
}

// ── SCROLL REVEAL ─────────────────────────────────────────────────────────
const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.1 });
document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

// ── PERSISTENCIA DE CREDENCIALES (localStorage) ───────────────────────────
try {
  const saved = localStorage.getItem('nayar_cfg');
  if (saved) {
    const cfg = JSON.parse(saved);
    if (cfg.channelId) document.getElementById('channelId').value = cfg.channelId;
    if (cfg.apiKey)    document.getElementById('apiKey').value    = cfg.apiKey;
  }
} catch (e) {}

['channelId', 'apiKey'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', () => {
    try {
      localStorage.setItem('nayar_cfg', JSON.stringify({
        channelId: document.getElementById('channelId').value,
        apiKey:    document.getElementById('apiKey').value,
      }));
    } catch (e) {}
  });
});
