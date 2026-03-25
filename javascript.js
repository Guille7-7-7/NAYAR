// ── MAPEO DE FIELDS THINGSPEAK ────────────────────────────
const FIELD_MAP = {
  field1: { label: 'RSSI Promedio',     kpi: 'kpiRssi',      unit: ' dBm' },
  field2: { label: 'Dispositivos',      kpi: 'kpiDevices',   unit: '' },
  field3: { label: 'Ocupación',         kpi: 'kpiOccupancy', unit: '%' },
  field4: { label: 'RSSI Mínimo',       kpi: null,           unit: ' dBm' },
  field5: { label: 'RSSI Máximo',       kpi: null,           unit: ' dBm' },
  field6: { label: 'Índice Energético', kpi: 'kpiEnergy',    unit: '' },
  field7: { label: 'Zonas Activas',     kpi: 'kpiZones',     unit: '' },
  field8: { label: 'Alertas Activas',   kpi: 'kpiAlerts',    unit: '' },
};

// ── ESTADO ────────────────────────────────────────────────
let pollingTimer = null;
let prevValues   = {};
let historyRssi  = [];
let historyDevs  = [];
let historyTimes = [];

// ── LOG ───────────────────────────────────────────────────
function addLog(level, msg) {
  const el  = document.getElementById('logEntries');
  const now = new Date().toLocaleTimeString('es-ES');
  const cls = level === 'WARN' ? 'log-level-warn'
            : level === 'ERR'  ? 'log-level-error'
            : level === 'OK'   ? 'log-level-ok'
            : 'log-level-info';
  el.insertAdjacentHTML('afterbegin',
    `<div class="log-line">
       <span class="log-time">${now}</span>
       <span class="${cls}">${level}</span>
       <span>${msg}</span>
     </div>`
  );
  if (el.children.length > 60) el.lastChild.remove();
}

function clearLog() {
  document.getElementById('logEntries').innerHTML = '';
}

// ── ERROR BANNER ──────────────────────────────────────────
function showError(msg) {
  const b = document.getElementById('errorBanner');
  b.textContent = '⚠ ' + msg;
  b.style.display = 'flex';
  addLog('ERR', msg);
}

function hideError() {
  const b = document.getElementById('errorBanner');
  b.textContent = '';
  b.style.display = 'none';
}

// ── ESTADO CONEXIÓN ───────────────────────────────────────
function setOnline() {
  const dot  = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  if (dot)  { dot.className = 'status-dot online'; }
  if (text) { text.textContent = 'EN LÍNEA'; }
}

function setOffline() {
  const dot  = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  if (dot)  { dot.className = 'status-dot offline'; }
  if (text) { text.textContent = 'SIN CONEXIÓN'; }
}

// ── FETCH THINGSPEAK ──────────────────────────────────────
async function fetchThingSpeak() {
  const channelId = document.getElementById('channelId').value.trim();
  const apiKey    = document.getElementById('apiKey').value.trim();

  if (!channelId) {
    showError('Introduce un Channel ID antes de conectar.');
    return;
  }

  const url = `https://api.thingspeak.com/channels/${channelId}/feeds.json?results=30${apiKey ? '&api_key=' + apiKey : ''}`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    if (!data.feeds || data.feeds.length === 0) {
      showError('Canal encontrado pero sin datos. ¿La Raspberry está enviando?');
      setOffline();
      return;
    }

    hideError();
    applyData(data);
    setOnline();
    document.getElementById('lastUpdate').textContent =
      'ACT: ' + new Date().toLocaleTimeString('es-ES');
    addLog('OK', `ThingSpeak OK · ${data.feeds.length} registros · canal: ${data.channel.name || channelId}`);
    document.getElementById('footerChannel').textContent =
      'Canal ThingSpeak: ' + (data.channel.name || channelId);

  } catch (err) {
    showError(`Error al conectar con ThingSpeak: ${err.message}`);
    setOffline();
    addLog('ERR', `ThingSpeak: ${err.message}`);
  }
}

// ── APLICAR DATOS ─────────────────────────────────────────
function applyData(data) {
  const feeds  = data.feeds;
  const latest = feeds[feeds.length - 1];

  // KPI cards
  Object.entries(FIELD_MAP).forEach(([field, cfg]) => {
    if (!cfg.kpi) return;
    const raw = latest[field];
    if (raw === null || raw === undefined || raw === '') return;
    const val = parseFloat(raw);
    const el  = document.getElementById(cfg.kpi);
    if (!el) return;
    el.innerHTML = isNaN(val) ? raw : (Number.isInteger(val) ? val : val.toFixed(1));
    updateTrend(field, val, prevValues[field]);
    prevValues[field] = val;
  });

  // Tabla de fields
  renderFieldsTable(latest);

  // Histórico para gráficas
  historyTimes = feeds.map(f => {
    const d = new Date(f.created_at);
    return String(d.getHours()).padStart(2,'0') + ':' +
           String(d.getMinutes()).padStart(2,'0');
  });
  historyRssi = feeds.map(f => parseFloat(f.field1) || 0);
  historyDevs = feeds.map(f => parseFloat(f.field2) || 0);

  drawLineChart('rssiChart', historyRssi, historyTimes, '#1a6cff', 'gradRssi', [-100, -20]);
  drawBarChart ('devChart',  historyDevs, historyTimes, '#6d28d9');

  document.getElementById('chartPoints').textContent   = `${feeds.length} puntos`;
  document.getElementById('devChartBadge').textContent = `MÁX: ${Math.max(...historyDevs)}`;
}

// ── TABLA DE FIELDS ───────────────────────────────────────
function renderFieldsTable(latest) {
  const tbody = document.getElementById('fieldsTableBody');
  if (!tbody) return;

  tbody.innerHTML = Object.entries(FIELD_MAP).map(([field, cfg]) => {
    const raw = latest[field];
    const val = (raw !== null && raw !== undefined && raw !== '')
      ? (isNaN(parseFloat(raw)) ? raw : parseFloat(raw).toFixed(2))
      : '—';
    return `<tr>
      <td>${field.toUpperCase()}</td>
      <td>${cfg.label}</td>
      <td>${val}${raw ? cfg.unit : ''}</td>
    </tr>`;
  }).join('');
}

// ── TENDENCIAS KPI ────────────────────────────────────────
function updateTrend(field, current, prev) {
  const map = {
    field1: 'trendRssi',    field2: 'trendDevices',
    field3: 'trendOcc',     field6: 'trendEnergy',
    field7: 'trendZones',   field8: 'trendAlerts',
  };
  const el = document.getElementById(map[field]);
  if (!el || prev === undefined) return;
  const diff = (current - prev).toFixed(1);
  if      (diff > 0)  el.textContent = `▲ +${diff}`;
  else if (diff < 0)  el.textContent = `▼ ${diff}`;
  else                el.textContent = `— 0`;
}

// ── GRÁFICA DE LÍNEA ──────────────────────────────────────
function drawLineChart(svgId, values, labels, color, gradId, yRange) {
  const svg = document.getElementById(svgId);
  if (!svg || values.length < 2) return;

  const W = 600, H = 180;
  const p = { t: 10, b: 30, l: 10, r: 10 };
  const min    = yRange ? yRange[0] : Math.min(...values) - 5;
  const max    = yRange ? yRange[1] : Math.max(...values) + 5;
  const xStep  = (W - p.l - p.r) / (values.length - 1);
  const yScale = v => p.t + (H - p.t - p.b) * (1 - (v - min) / (max - min));
  const pts    = values.map((v, i) => `${p.l + i * xStep},${yScale(v)}`).join(' ');
  const area   = `${p.l + (values.length - 1) * xStep},${H - p.b} ${p.l},${H - p.b}`;

  let ticks = '';
  values.forEach((v, i) => {
    if (i % 5 === 0)
      ticks += `<text x="${p.l + i * xStep}" y="${H - 8}" text-anchor="middle" fill="rgba(17,24,39,0.35)" font-family="Space Mono,monospace" font-size="8">${labels[i] || ''}</text>`;
  });

  svg.innerHTML = `
    <defs>
      <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="${color}" stop-opacity="0.25"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${[0.25, 0.5, 0.75].map(f =>
      `<line x1="${p.l}" y1="${p.t + (H - p.t - p.b) * f}" x2="${W - p.r}" y2="${p.t + (H - p.t - p.b) * f}"
             stroke="rgba(17,24,39,0.08)" stroke-width="1" stroke-dasharray="4,4"/>`
    ).join('')}
    <polygon points="${pts} ${area}" fill="url(#${gradId})"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
    ${values.map((v, i) =>
      `<circle cx="${p.l + i * xStep}" cy="${yScale(v)}" r="2.5" fill="${color}" opacity="0.8"/>`
    ).join('')}
    ${ticks}
    <text x="${W - p.r - 4}" y="${yScale(values[values.length - 1]) - 8}"
          text-anchor="end" fill="${color}"
          font-family="Space Mono,monospace" font-size="10" font-weight="bold">
      ${values[values.length - 1].toFixed(1)}
    </text>
  `;
}

// ── GRÁFICA DE BARRAS ─────────────────────────────────────
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
                     fill="rgba(17,24,39,0.35)" font-family="Space Mono,monospace" font-size="8">
                ${labels[i] || ''}</text>`;
  });

  svg.innerHTML = `
    ${[0.25, 0.5, 0.75, 1].map(f => {
      const y = p.t + (H - p.t - p.b) * (1 - f);
      return `<line x1="${p.l}" y1="${y}" x2="${W - p.r}" y2="${y}"
                    stroke="rgba(17,24,39,0.08)" stroke-width="1" stroke-dasharray="4,4"/>
              <text x="${p.l + 2}" y="${y - 3}" fill="rgba(17,24,39,0.35)"
                    font-family="Space Mono,monospace" font-size="8">
                ${Math.round(max * f)}
              </text>`;
    }).join('')}
    ${bars}
  `;
}

// ── POLLING ───────────────────────────────────────────────
function startPolling() {
  stopPolling();
  addLog('INFO', 'Conectando con ThingSpeak...');
  fetchThingSpeak();
  pollingTimer = setInterval(fetchThingSpeak, 30000);
  addLog('INFO', 'Actualizando cada 30 s.');
}

function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
    addLog('INFO', 'Polling detenido.');
    setOffline();
  }
}

// ── INIT ──────────────────────────────────────────────────
addLog('INFO', 'NAYAR listo. Introduce Channel ID + API Key y pulsa Conectar.');

// Restaurar credenciales guardadas
try {
  const saved = localStorage.getItem('nayar_cfg');
  if (saved) {
    const cfg = JSON.parse(saved);
    if (cfg.channelId) document.getElementById('channelId').value = cfg.channelId;
    if (cfg.apiKey)    document.getElementById('apiKey').value    = cfg.apiKey;
    addLog('INFO', 'Credenciales restauradas.');
  }
} catch (e) {}

// Guardar credenciales al cambiar los inputs
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
