import requests
import time
import subprocess
import re
from datetime import datetime

# ── CONFIGURACIÓN ──────────────────────────────────────────
API_KEY      = "TSXNP7UL4V51O25E"
URL          = "https://api.thingspeak.com/update"
INTERFACE    = "wlan0"
MAX_CAPACITY = 20   # nº de dispositivos que consideras "aforo completo"

# ── UMBRALES RSSI PARA CLASIFICAR DISTANCIA ────────────────
# Modelo log-distance igual al JS: d = 10^((TxPower - RSSI) / (10 * n))
# TxPower = -40 dBm a 1 m,  n = 2.0
def rssi_to_metros(rssi):
    tx_power = -40
    n = 2.0
    metros = 10 ** ((tx_power - rssi) / (10 * n))
    return round(max(0.1, min(metros, 99.9)), 1)

# ── CLASIFICAR DISPOSITIVO POR RSSI ───────────────────────
# Heurística de distancia:
#   < 2 m   → muy cerca → probable Móvil (bolsillo/mano)
#   2-5 m   → cerca     → probable Portátil (mesa)
#   5-15 m  → medio     → probable IoT/Smart (instalado fijo)
#   > 15 m  → lejos     → Otro / paso
def classify_device(rssi):
    d = rssi_to_metros(rssi)
    if   d < 2:   return "mobile"
    elif d < 5:   return "laptop"
    elif d < 15:  return "iot"
    else:          return "other"

# ── ESCANEAR WiFi ──────────────────────────────────────────
def escanear_wifi():
    """Devuelve lista de RSSI de todas las redes/dispositivos detectados."""
    try:
        resultado = subprocess.run(
            ["sudo", "iwlist", INTERFACE, "scan"],
            capture_output=True, text=True, timeout=15
        )
        rssi_valores = re.findall(r"Signal level=(-\d+) dBm", resultado.stdout)
        return [int(r) for r in rssi_valores]
    except Exception as e:
        print(f"Error escaneando: {e}")
        return []

# ── BUCLE PRINCIPAL ────────────────────────────────────────
while True:

    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Escaneando {INTERFACE}...")
    active_rssi = escanear_wifi()

    if not active_rssi:
        print("Sin señales detectadas, reintentando en 15 s...")
        time.sleep(15)
        continue

    # ── field1 → RSSI Promedio (dBm)  →  web lo convierte a metros
    field1 = round(sum(active_rssi) / len(active_rssi), 1)

    # ── field2 → Dispositivos detectados
    field2 = len(active_rssi)

    # ── field3 → Ocupación (%)
    field3 = min(100, round((field2 / MAX_CAPACITY) * 100))

    # ── fields 4-7 → Clasificación por tipo (heurística de distancia)
    counts = {"mobile": 0, "laptop": 0, "iot": 0, "other": 0}
    for rssi in active_rssi:
        counts[classify_device(rssi)] += 1

    field4 = counts["mobile"]   # Móviles
    field5 = counts["laptop"]   # Portátiles
    field6 = counts["iot"]      # IoT / Smart
    field7 = counts["other"]    # Otros

    # ── field8 → Alertas activas
    field8 = 0
    if field3 >= 90:                        # Aforo casi lleno
        field8 += 1
    if field1 < -75 and field2 > 0:        # Señal muy débil con gente
        field8 += 1

    # ── Enviar a ThingSpeak
    payload = {
        "api_key": API_KEY,
        "field1":  field1,
        "field2":  field2,
        "field3":  field3,
        "field4":  field4,
        "field5":  field5,
        "field6":  field6,
        "field7":  field7,
        "field8":  field8,
    }

    r = requests.post(URL, data=payload)

    dist_media = rssi_to_metros(field1)
    print(f"  Dispositivos : {field2}  (aforo {field3}%)")
    print(f"  RSSI promedio: {field1} dBm  →  {dist_media} m")
    print(f"  Tipos        : móviles={field4}  portátiles={field5}  IoT={field6}  otros={field7}")
    print(f"  Alertas      : {field8}")
    print(f"  ThingSpeak   : entry_id={r.text.strip()}")
    print("─" * 48)

    time.sleep(15)
