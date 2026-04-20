// ── MAPEO DE FIELDS THINGSPEAK ────────────────────────────────────────
// Ajusta estos fields según lo que envía tu Raspberry Pi
const FIELD_MAP = {
  field1: 'rssi',          // RSSI medio (se convierte a metros)
  field2: 'devices',       // Dispositivos totales detectados
  field3: 'occupancy',     // % ocupación general
  field4: 'zonaA',         // Dispositivos Zona A
  field5: 'zonaB',         // Dispositivos Zona B
  field6: 'zonaC',         // Dispositivos Zona C
  field7: 'estanciaA',     // Tiempo medio estancia Zona A (minutos)
  field8: 'estanciaB',     // Tiempo medio estancia Zona B (minutos)
  // Si tienes más fields para estancia C u ocupación de salas, amplía aquí
};

// ── ESTADO ────────────────────────────────────────────────────────────
let pollingTimer  = null;
let weeklyData    = [0, 0, 0, 0, 0, 0, 0]; // ocupación acumulada por día (lun-dom)
let weeklyCount   = [0, 0, 0, 0, 0, 0, 0]; // muestras por día (para promedio)

// ── CONVERSIÓN RSSI → METROS ─────────────────────────────────────────
function rssiToMetros(rssi) {
  const txPower = -40;
  const n       = 2.0;
  if (!rssi || isNaN(rssi)) return null;
  const metros = Math.pow(10, (txPower - rssi) / (10 * n));
  return Math.max(0.1, Math.min(metros, 99.9));
}

// ── HELPERS DOM ───────────────────────────────────────────────────────
function setText(id, value) {
  const e = document.getElementById(id);
  if (e) e.textContent = value;
}

function setWidth(id, pct) {
  const e = document.getElementById(id);
  if (e) e.style.width = Math.min(100, Math.max(0, pct)) + '%';
}

function setPill(pillId, pct) {
  const e = document.getElementById(pillId);
  if (!e) return;
  if (pct > 80) { e.className = 'ocup-pill hi';  e.textContent = 'Alta'; }
  else if (pct > 60) { e.className = 'ocup-pill mid'; e.textContent = 'Media'; }
  else               { e.className = 'ocup-pill ok';  e.textContent = 'Normal'; }
}

// ── ESTADO CONEXIÓN ───────────────────────────────────────────────────
function setOnline() {
  const dot   = document.getElementById('statusDot');
  const label = document.getElementById('statusLabel');
  if (dot)   { dot.className = 'status-dot online'; }
  if (label) label.textContent = 'En directo';
}

function setOffline() {
  const dot   = document.getElementById('statusDot');
  const label = document.getElementById('statusLabel');
  if (dot)   { dot.className = 'status-dot'; dot.style.background = 'rgba(17,24,39,0.22)'; }
  if (label) label.textContent = 'Sin conexión';
}

// ── FETCH THINGSPEAK ──────────────────────────────────────────────────
async function fetchThingSpeak() {
  const channelId = (document.getElementById('channelId') || {}).value?.trim();
  const apiKey    = (document.getElementById('apiKey')    || {}).value?.trim();

  if (!channelId) return;

  const url = `https://api.thingspeak.com/channels/${channelId}/feeds.json?results=30${apiKey ? '&api_key=' + apiKey : ''}`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    if (!data.feeds || data.feeds.length === 0) {
      setOffline();
      return;
    }

    applyData(data);
    setOnline();

  } catch (err) {
    console.warn('ThingSpeak error:', err.message);
    setOffline();
  }
}

// ── APLICAR DATOS ─────────────────────────────────────────────────────
function applyData(data) {
  const feeds  = data.feeds;
  const latest = feeds[feeds.length - 1];

  // ── 1. DISPOSITIVOS EN TIEMPO REAL ─────────────────────────────────
  const zonaA = parseFloat(latest.field4) || 0;
  const zonaB = parseFloat(latest.field5) || 0;
  const zonaC = parseFloat(latest.field6) || 0;
  const total = zonaA + zonaB + zonaC;

  setText('rtZonaA', Math.round(zonaA));
  setText('rtZonaB', Math.round(zonaB));
  setText('rtZonaC', Math.round(zonaC));
  setText('rtTotal', Math.round(total));

  // Fallback: si no hay fields de zona, usar field2 como total
  if (total === 0) {
    const devTotal = parseFloat(latest.field2) || 0;
    setText('rtTotal', Math.round(devTotal));
  }

  // ── 2. TIEMPO MEDIO DE ESTANCIA ────────────────────────────────────
  const estA = parseFloat(latest.field7);
  const estB = parseFloat(latest.field8);
  // field para estancia C: amplía FIELD_MAP si lo tienes disponible

  if (!isNaN(estA)) {
    setText('estZonaA', Math.round(estA));
    setWidth('estZonaABar', (estA / 90) * 100); // 90 min = 100%
  }
  if (!isNaN(estB)) {
    setText('estZonaB', Math.round(estB));
    setWidth('estZonaBBar', (estB / 90) * 100);
  }
  // estZonaC: sin field asignado por ahora, se mantiene en simulación

  // ── 3. OCUPACIÓN EN TIEMPO REAL ────────────────────────────────────
  const rawOcc = parseFloat(latest.field3);

  if (!isNaN(rawOcc)) {
    // Escritorios: usamos la ocupación general
    const escPct = Math.round(rawOcc);
    const escOc  = Math.round(50 * escPct / 100);
    setText('ocupEsc', escPct);
    setText('ocupEscDetalle', `${escOc} de 50 escritorios ocupados`);
    setText('ocupEscLib', `${50 - escOc} libres`);
    setWidth('ocupEscBar', escPct);
    setPill('ocupEscPill', escPct);

    // Salas: estimación proporcional (ajusta si tienes field propio)
    const salaPct = Math.min(100, Math.round(rawOcc * 1.15));
    const salaOc  = Math.round(6 * salaPct / 100);
    setText('ocupSala', salaPct);
    setText('ocupSalaDetalle', `${salaOc} de 6 salas ocupadas`);
    setText('ocupSalaLib', `${6 - salaOc} libre${6 - salaOc === 1 ? '' : 's'}`);
    setWidth('ocupSalaBar', salaPct);
    setPill('ocupSalaPill', salaPct);
  }

  // ── 4. TENDENCIA SEMANAL ────────────────────────────────────────────
  // Acumular ocupación histórica por día de la semana
  feeds.forEach(f => {
    const occ = parseFloat(f.field3);
    if (isNaN(occ)) return;
    const d = new Date(f.created_at);
    // getDay(): 0=dom → mapeamos a índice lun=0 … dom=6
    const idx = d.getDay() === 0 ? 6 : d.getDay() - 1;
    weeklyData[idx]  += occ;
    weeklyCount[idx] += 1;
  });

  renderWeekly();
}

// ── TENDENCIA SEMANAL ─────────────────────────────────────────────────
function renderWeekly() {
  const days      = ['LUN','MAR','MIÉ','JUE','VIE','SÁB','DOM'];
  const todayIdx  = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
  const container = document.getElementById('weeklyDays');
  if (!container) return;

  container.innerHTML = '';

  days.forEach((d, i) => {
    const pct = weeklyCount[i] > 0
      ? Math.round(weeklyData[i] / weeklyCount[i])
      : 0;

    const isToday   = i === todayIdx;
    const isWeekend = i >= 5;
    const barH      = pct ? Math.round((pct / 100) * 80) : 4;
    const barColor  = isWeekend        ? 'rgba(17,24,39,0.12)' :
                      isToday          ? '#1a6cff'              :
                      pct >= 75        ? '#d97706'              :
                      pct >= 50        ? '#2563eb'              : '#00a85e';

    const div = document.createElement('div');
    div.className = 'weekly-day' + (isToday ? ' wd-today' : '');
    div.innerHTML = `
      <div class="wd-name">${d}</div>
      <div class="wd-bar-wrap">
        <div class="wd-bar" style="height:${barH}px;background:${barColor};width:60%;${isToday ? 'box-shadow:0 0 14px rgba(26,108,255,0.4);' : ''}"></div>
      </div>
      <div class="wd-pct" style="color:${isToday ? 'var(--cyan)' : 'var(--text)'}">
        ${pct ? pct + '%' : '—'}
      </div>
    `;
    container.appendChild(div);

    if (isToday) {
      setText('weeklyHoy', pct ? pct + '%' : '—');
    }
  });
}

// ── NÚMERO DE SEMANA ──────────────────────────────────────────────────
(function setWeekBadge() {
  const now   = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const week  = Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7);
  setText('weekBadge', 'Semana ' + week);
})();

// ── POLLING ───────────────────────────────────────────────────────────
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
  }
}

// ── CREDENCIALES (si hay config bar en la página) ─────────────────────
try {
  const saved = localStorage.getItem('nayar_cfg');
  if (saved) {
    const cfg = JSON.parse(saved);
    const chEl = document.getElementById('channelId');
    const akEl = document.getElementById('apiKey');
    if (cfg.channelId && chEl) chEl.value = cfg.channelId;
    if (cfg.apiKey    && akEl) akEl.value = cfg.apiKey;
  }
} catch (e) {}

['channelId', 'apiKey'].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', () => {
    try {
      localStorage.setItem('nayar_cfg', JSON.stringify({
        channelId: document.getElementById('channelId')?.value,
        apiKey:    document.getElementById('apiKey')?.value,
      }));
    } catch (e) {}
  });
});

// ── ARRANQUE AUTOMÁTICO ───────────────────────────────────────────────
// Si ya hay credenciales guardadas, conectar al cargar la página
window.addEventListener('DOMContentLoaded', () => {
  const chEl = document.getElementById('channelId');
  if (chEl && chEl.value) startPolling();
});
