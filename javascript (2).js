// ── MAPEO DE FIELDS THINGSPEAK ────────────────────────────
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

// ── ESTADO ────────────────────────────────────────────────
let pollingTimer = null;
let prevValues   = {};
let historyRssi  = [];
let historyDevs  = [];
let historyTimes = [];

// ── CONVERSIÓN RSSI → METROS ──────────────────────────────
// Modelo log-distance: d = 10 ^ ((TxPower - RSSI) / (10 * n))
// TxPower ≈ -40 dBm a 1 m, n = 2.0 (espacio abierto interior)
function rssiToMetros(rssi) {
  const txPower = -40;
  const n       = 2.0;
  if (!rssi || isNaN(rssi)) return null;
  const metros = Math.pow(10, (txPower - rssi) / (10 * n));
  return Math.max(0.1, Math.min(metros, 99.9));
}

// ── ERROR BANNER ──────────────────────────────────────────
function showError(msg) {
  const b = document.getElementById('errorBanner');
  b.textContent = '⚠ ' + msg;
  b.style.display = 'flex';
}

function hideError() {
  const b = document.getElementById('errorBanner');
  b.textContent = '';
  b.style.display = 'none';
}

// ── ESTADO CONEXIÓN ───────────────────────────────────────
function setOnline() {
  const dot   = document.getElementById('statusDot');
  const label = document.getElementById('statusLabel');
  if (dot)   dot.className  = 'status-dot online';
  if (label) label.textContent = 'En línea';
}

function setOffline() {
  const dot   = document.getElementById('statusDot');
  const label = document.getElementById('statusLabel');
  if (dot)   dot.className  = 'status-dot offline';
  if (label) label.textContent = 'Sin conexión';
}

// ── FETCH THINGSPEAK ──────────────────────────────────────
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
    document.getElementById('lastUpdate').textContent = 'Actualizado: ' + now;
    document.getElementById('footerChannel').textContent =
      'Canal: ' + (data.channel.name || channelId);

  } catch (err) {
    showError('No se pudo conectar con ThingSpeak: ' + err.message);
    setOffline();
  }
}

// ── APLICAR DATOS ─────────────────────────────────────────
function applyData(data) {
  const feeds  = data.feeds;
  const latest = feeds[feeds.length - 1];

  // ── KPI: Dispositivos
  const rawDevices = parseFloat(latest.field2);
  if (!isNaN(rawDevices)) {
    document.getElementById('kpiDevices').textContent = Math.round(rawDevices);
    updateTrend('field2', rawDevices, prevValues.field2);
    prevValues.field2 = rawDevices;
  }

  // ── KPI: Distancia media (RSSI → metros)
  const rawRssi   = parseFloat(latest.field1);
  const metros    = rssiToMetros(rawRssi);
  const kpiRssiEl = document.getElementById('kpiRssi');
  if (metros !== null && kpiRssiEl) {
    kpiRssiEl.textContent = metros.toFixed(1);
    updateTrend('field1', metros, prevValues.field1);
    prevValues.field1 = metros;
  }

  // ── KPI: Ocupación
  const rawOcc = parseFloat(latest.field3);
  if (!isNaN(rawOcc)) {
    document.getElementById('kpiOccupancy').textContent = Math.round(rawOcc);
    updateTrend('field3', rawOcc, prevValues.field3);
    prevValues.field3 = rawOcc;
  }

  // ── Tipos de dispositivos (fields 4-7)
  renderDeviceTypes(latest);

  // ── Histórico para gráficas
  historyTimes = feeds.map(f => {
    const d = new Date(f.created_at);
    return String(d.getHours()).padStart(2,'0') + ':' +
           String(d.getMinutes()).padStart(2,'0');
  });

  // Convertir historial RSSI a metros
  historyRssi = feeds.map(f => {
    const m = rssiToMetros(parseFloat(f.field1));
    return m !== null ? parseFloat(m.toFixed(1)) : 0;
  });
  historyDevs = feeds.map(f => parseFloat(f.field2) || 0);

  drawLineChart('rssiChart', historyRssi, historyTimes, '#2563eb', 'gradRssi', null);
  drawBarChart ('devChart',  historyDevs, historyTimes, '#6d28d9');

  document.getElementById('chartPoints').textContent =
    feeds.length + ' datos';
  document.getElementById('devChartBadge').textContent =
    'Máx: ' + Math.max(...historyDevs);
}

// ── TIPOS DE DISPOSITIVOS ─────────────────────────────────
function renderDeviceTypes(latest) {
  const mobile = parseFloat(latest.field4) || 0;
  const laptop = parseFloat(latest.field5) || 0;
  const iot    = parseFloat(latest.field6) || 0;
  const other  = parseFloat(latest.field7) || 0;
  const total  = mobile + laptop + iot + other || 1; // evitar división por 0

  const types = [
    { id: 'Mobile', val: mobile },
    { id: 'Laptop', val: laptop },
    { id: 'Iot',    val: iot    },
    { id: 'Other',  val: other  },
  ];

  types.forEach(({ id, val }) => {
    const pct = Math.round((val / total) * 100);
    const countEl = document.getElementById('dev' + id);
    const pctEl   = document.getElementById('dev' + id + 'Pct');
    const barEl   = document.getElementById('dev' + id + 'Bar');
    if (countEl) countEl.textContent = Math.round(val);
    if (pctEl)   pctEl.textContent   = pct + '% del total';
    if (barEl)   barEl.style.width   = pct + '%';
  });
}

// ── TENDENCIAS KPI ────────────────────────────────────────
function updateTrend(field, current, prev) {
  const map = {
    field1: 'trendRssi',
    field2: 'trendDevices',
    field3: 'trendOcc',
  };
  const el = document.getElementById(map[field]);
  if (!el || prev === undefined) return;
  const diff = parseFloat((current - prev).toFixed(1));
  if      (diff > 0) el.textContent = '▲ +' + diff;
  else if (diff < 0) el.textContent = '▼ '  + diff;
  else               el.textContent = '— sin cambio';
}

// ── GRÁFICA DE LÍNEA ──────────────────────────────────────
function drawLineChart(svgId, values, labels, color, gradId, yRange) {
  const svg = document.getElementById(svgId);
  if (!svg || values.length < 2) return;

  const W = 600, H = 180;
  const p = { t: 10, b: 30, l: 10, r: 10 };
  const min    = yRange ? yRange[0] : Math.min(...values) - 1;
  const max    = yRange ? yRange[1] : Math.max(...values) + 1;
  const xStep  = (W - p.l - p.r) / (values.length - 1);
  const yScale = v => p.t + (H - p.t - p.b) * (1 - (v - min) / (max - min));
  const pts    = values.map((v, i) => `${p.l + i * xStep},${yScale(v)}`).join(' ');
  const area   = `${p.l + (values.length - 1) * xStep},${H - p.b} ${p.l},${H - p.b}`;

  let ticks = '';
  values.forEach((v, i) => {
    if (i % 5 === 0)
      ticks += `<text x="${p.l + i * xStep}" y="${H - 8}" text-anchor="middle"
                      fill="rgba(17,24,39,0.35)" font-family="Space Mono,monospace" font-size="8">
                  ${labels[i] || ''}
                </text>`;
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
      ${values[values.length - 1].toFixed(1)} m
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
                 ${labels[i] || ''}
               </text>`;
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
  fetchThingSpeak();
  pollingTimer = setInterval(fetchThingSpeak, 30000);
}

function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
    setOffline();
    document.getElementById('lastUpdate').textContent = '';
  }
}

// ── INIT ──────────────────────────────────────────────────
// Restaurar credenciales guardadas
try {
  const saved = localStorage.getItem('nayar_cfg');
  if (saved) {
    const cfg = JSON.parse(saved);
    if (cfg.channelId) document.getElementById('channelId').value = cfg.channelId;
    if (cfg.apiKey)    document.getElementById('apiKey').value    = cfg.apiKey;
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
