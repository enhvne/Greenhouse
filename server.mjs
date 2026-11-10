import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const POLL_MS = 10_000;
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const sensors = ['temp', 'humidity', 'soil', 'light', 'water'];
const deviceIds = ['pump', 'fan', 'lamp'];
const limits = { temp: [-50, 100], humidity: [0, 100], soil: [0, 100], light: [0, 200000], water: [0, 100] };
function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}
export function validateSettings(value) {
  requireValue(value && typeof value === 'object', 'Settings missing');
  for (const [key, min, max] of [['hot', 10, 50], ['dry', 5, 90], ['waterMin', 5, 90]]) {
    requireValue(Number.isFinite(value[key]) && value[key] >= min && value[key] <= max, 'Invalid setting: ' + key);
  }
  for (const key of ['lightStart', 'lightEnd']) {
    requireValue(typeof value[key] === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value[key]), 'Invalid time');
  }
  requireValue(value.lightStart !== value.lightEnd, 'Light times must differ');
  return Object.fromEntries(['hot', 'dry', 'waterMin', 'lightStart', 'lightEnd'].map(key => [key, value[key]]));
}
export function validateStatus(value) {
  requireValue(value && typeof value.sampleId === 'string' && value.sampleId.length > 0 && value.sampleId.length <= 100, 'sampleId required');
  const values = {};
  for (const key of sensors) {
    const reading = value.values?.[key];
    requireValue(reading === null || (Number.isFinite(reading) && reading >= limits[key][0] && reading <= limits[key][1]), 'Invalid sensor: ' + key);
    values[key] = reading;
  }
  const devices = {};
  for (const id of deviceIds) {
    const device = value.devices?.[id];
    requireValue(device && typeof device.on === 'boolean' && ['manual', 'auto'].includes(device.mode), 'Invalid device: ' + id);
    devices[id] = { on: device.on, mode: device.mode };
  }
  return { sampleId: value.sampleId, values, devices, settings: validateSettings(value.settings) };
}

export async function createGreenhouse({
  root = path.dirname(fileURLToPath(import.meta.url)),
  dataDir = path.join(root, 'data'),
  espUrl = '',
  espToken = '',
  live = false,
  now = Date.now,
  fetchDevice = fetch,
  startPolling = true
} = {}) {
  if (live) {
    const url = new URL(espUrl);
    requireValue(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, 'Invalid ESP32 URL');
    requireValue(espToken.length >= 16, 'Set ESP32_TOKEN with at least 16 characters');
  }
  await mkdir(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'greenhouse.sqlite'));
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA secure_delete=ON;
    CREATE TABLE IF NOT EXISTS samples (
      id INTEGER PRIMARY KEY, at INTEGER NOT NULL, sample_id TEXT NOT NULL UNIQUE,
      temp REAL, humidity REAL, soil REAL, light REAL, water REAL
    );
    CREATE INDEX IF NOT EXISTS samples_at ON samples(at);
  `);
  const insert = db.prepare('INSERT OR IGNORE INTO samples(at,sample_id,temp,humidity,soil,light,water) VALUES(?,?,?,?,?,?,?)');
  const removeOld = db.prepare('DELETE FROM samples WHERE at < ?');
  const csrf = randomBytes(24).toString('hex');
  let latest = null;
  let lastSampleAt = 0;
  let lastSuccess = 0;
  let lastError = null;
  let busy = false;
  let closed = false;

  function prune() { removeOld.run(now() - RETENTION_MS); }
  function store(status) {
    const receivedAt = now();
    // Repeated sample IDs never turn an old measurement into a new one.
    const inserted = insert.run(receivedAt, status.sampleId, ...sensors.map(key => status.values[key]));
    const row = db.prepare('SELECT at FROM samples WHERE sample_id=?').get(status.sampleId);
    lastSampleAt = row?.at || lastSampleAt;
    latest = status;
    lastSuccess = receivedAt;
    lastError = null;
    prune();
    return inserted.changes > 0;
  }
  async function deviceRequest(endpoint, method = 'GET', body) {
    const response = await fetchDevice(new URL(endpoint, espUrl), {
      method, signal: AbortSignal.timeout(5000),
      headers: { Authorization: 'Bearer ' + espToken, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    requireValue(response.ok, 'ESP32 HTTP ' + response.status);
    const text = await response.text();
    requireValue(text.length < 65536, 'ESP32 response too large');
    return JSON.parse(text);
  }
  async function poll() {
    prune();
    if (!live || busy || closed) return;
    busy = true;
    try { store(validateStatus(await deviceRequest('/api/status'))); }
    catch (error) { lastError = error.message; }
    finally { busy = false; }
  }
  function connection() {
    const stale = !latest || now() - lastSampleAt > 25000;
    return { mode: live ? 'live' : 'demo', connected: live && !stale && !lastError, stale,
      lastSuccess: lastSuccess || null, sampledAt: lastSampleAt || null, error: lastError };
  }
  async function mutate(endpoint, body, verify) {
    requireValue(live, 'Live mode is disabled');
    requireValue(!busy, 'Device busy. Try again shortly.');
    busy = true;
    try {
      const commandId = randomUUID();
      const reply = await deviceRequest(endpoint, 'POST', { ...body, commandId });
      requireValue(reply.commandId === commandId && reply.applied === true, 'Command was not confirmed');
      const status = validateStatus(reply.status);
      requireValue(verify(status), 'Returned device state does not match request');
      store(status);
      return { commandId, confirmed: true, status, connection: connection() };
    } catch (error) {
      lastError = 'Command unconfirmed: ' + error.message;
      throw error; // Never retry a physical command automatically.
    } finally { busy = false; }
  }
  const staticFiles = new Map([
    ['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']],
    ['/app.js', ['app.js', 'text/javascript']], ['/live.js', ['live.js', 'text/javascript']],
    ['/styles.css', ['styles.css', 'text/css']], ['/botanical.css', ['botanical.css', 'text/css']],
    ['/motion.css', ['motion.css', 'text/css']], ['/assets/greenhouse-hero.png', ['assets/greenhouse-hero.png', 'image/png']]
  ]);
  function send(res, code, body) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }
  async function readBody(req) {
    let size = 0;
    const parts = [];
    for await (const chunk of req) {
      size += chunk.length;
      requireValue(size <= 8192, 'Request too large');
      parts.push(chunk);
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  }
  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host;
      // Local-only listener and Host checks also prevent DNS-rebinding access.
      requireValue(/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host || ''), 'Invalid host');
      const url = new URL(req.url, 'http://' + host);
      if (url.pathname === '/api/status' && req.method === 'GET') {
        prune();
        return send(res, 200, { status: latest, connection: connection() });
      }
      if (url.pathname === '/api/history' && req.method === 'GET') {
        prune();
        const hours = Number(url.searchParams.get('hours') || 24);
        requireValue(Number.isFinite(hours) && hours > 0 && hours <= 720, 'History range must be 0–720 hours');
        const since = Math.max(now() - hours * 3600000, now() - RETENTION_MS);
        // At most ~720 points travel to the phone. Raw 10-second samples stay in SQLite.
        const bucket = Math.max(10000, Math.ceil(hours * 3600000 / 720));
        const rows = db.prepare(`SELECT MAX(at) AS at, AVG(temp) AS temp,
          AVG(humidity) AS humidity, AVG(soil) AS soil, AVG(light) AS light, AVG(water) AS water
          FROM samples WHERE at >= ? GROUP BY CAST(at / ? AS INTEGER) ORDER BY at`).all(since, bucket);
        return send(res, 200, { rows, aggregationMs: bucket, retentionDays: 30 });
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        requireValue(req.headers['x-greenhouse-csrf'] === csrf, 'Invalid request token');
        if (req.headers.origin) requireValue(req.headers.origin === 'http://' + host, 'Invalid origin');
        requireValue(req.headers['content-type']?.startsWith('application/json'), 'JSON required');
        const body = await readBody(req);
        if (url.pathname === '/api/settings') {
          const settings = validateSettings(body);
          const result = await mutate('/api/settings', { settings },
            status => JSON.stringify(status.settings) === JSON.stringify(settings));
          return send(res, 200, result);
        }
        const id = url.pathname.split('/')[3];
        requireValue(url.pathname === '/api/devices/' + id && deviceIds.includes(id), 'Unknown device');
        requireValue(['on', 'off', 'manual', 'auto'].includes(body.action), 'Invalid action');
        const { action } = body;
        if (action !== 'off') requireValue(connection().connected, 'ESP32 data is stale or offline');
        if (['on', 'off'].includes(action)) {
          requireValue(action === 'off' || latest.devices[id].mode === 'manual', 'Select manual mode first');
        }
        if (id === 'pump' && action === 'on') {
          requireValue(latest.values.water !== null && latest.values.water >= latest.settings.waterMin, 'Water level too low or unknown');
        }
        const result = await mutate('/api/devices/' + id, { action }, status =>
          ['on', 'off'].includes(action) ? status.devices[id].on === (action === 'on') : status.devices[id].mode === action);
        return send(res, 200, result);
      }
      if (req.method === 'GET' && url.pathname === '/runtime-config.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
        return res.end('window.GREENHOUSE_RUNTIME=' + JSON.stringify({ live, csrf, pollMs: POLL_MS }) + ';');
      }
      requireValue(req.method === 'GET', 'Method not supported');
      const file = staticFiles.get(url.pathname);
      if (!file) return send(res, 404, { error: 'Not found' });
      const data = await readFile(path.join(root, file[0]));
      res.writeHead(200, { 'Content-Type': file[1] + (file[1].startsWith('image/') ? '' : '; charset=utf-8'), 'Cache-Control': 'no-cache' });
      res.end(data);
    } catch (error) { if (!res.headersSent) send(res, 400, { error: error.message }); else res.end(); }
  });
  prune();
  const timer = setInterval(() => { void poll(); }, POLL_MS);
  timer.unref();
  if (startPolling) await poll();
  return {
    server, poll, connection,
    close: async () => {
      closed = true;
      clearInterval(timer);
      while (busy) await new Promise(resolve => setTimeout(resolve, 20));
      await new Promise(resolve => server.listening ? server.close(resolve) : resolve());
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      db.close();
    }
  };
}
