'use strict';
// Loaded after app.js. Demo stays unchanged unless the server explicitly enables live mode.
let liveBusy = false;
let liveSyncing = false;
let liveConnected = false;
function friendlyLiveError(message = '') {
  const messages = [
    ['Device busy', 'Төхөөрөмж завгүй байна. Түр хүлээгээд дахин оролдоорой.'],
    ['stale or offline', 'Шинэ хэмжилт ирэхгүй байна. Холболтоо шалгаарай.'],
    ['manual mode', 'Эхлээд «Гар» горимыг сонгоорой.'],
    ['Water level', 'Ус бага эсвэл түвшин нь тодорхойгүй байна. Саваа шалгаарай.'],
    ['Invalid setting', 'Тохируулсан утгаа зөвшөөрөгдсөн хязгаарт оруулаарай.'],
    ['Invalid time', 'Цагаа дахин шалгаарай.'],
    ['times must differ', 'Асах, унтрах цагийг ялгаатай сонгоорой.'],
    ['Invalid request token', 'Хуудсаа шинэчлээд дахин оролдоорой.'],
    ['Live mode is disabled', 'Бодит төхөөрөмжийн холболт идэвхжээгүй байна.']
  ];
  return messages.find(([part]) => message.includes(part))?.[1] ||
    'Төхөөрөмжийн хариуг шалгаж чадсангүй. Холболтоо шалгаарай.';
}
async function liveRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options, signal: AbortSignal.timeout(8000),
    headers: { 'Content-Type': 'application/json', 'X-Greenhouse-CSRF': window.GREENHOUSE_RUNTIME?.csrf || '', ...options.headers }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Холболтын алдаа');
  return data;
}
function liveControls() {
  if (!liveMode) return;
  for (const button of document.querySelectorAll('[data-device]')) {
    const d = state.devices[button.dataset.device];
    const action = button.dataset.action;
    button.disabled = liveBusy || !liveConnected ||
      (['on', 'off'].includes(action) && (d.mode === 'auto' || d.on === (action === 'on')));
  }
  for (const field of $('settings-form').elements) field.disabled = liveBusy || !liveConnected;
}
function acceptLive(data) {
  const wasConnected = liveConnected;
  liveConnected = data.connection.connected;
  const badgeElement = document.querySelector('.top .pill');
  badgeElement.textContent = liveConnected ? 'ESP32 · Холбогдлоо' : 'ESP32 · Хүлээж байна';
  if (data.status) {
    state.values = data.status.values;
    state.devices = data.status.devices;
    // Preserve an unsaved settings draft while refreshing telemetry.
    if (!settingsDirty) { state.settings = data.status.settings; fillSettings(); }
  }
  render();
  $('updated').textContent = data.connection.sampledAt
    ? (liveConnected ? 'Шинэчлэгдсэн · ' : 'Хуучин хэмжилт · ') + dateTime(data.connection.sampledAt)
    : 'ESP32-оос эхний хэмжилтийг хүлээж байна';
  if (wasConnected !== liveConnected) {
    event(liveConnected ? 'ESP32 холбогдлоо. Бодит хэмжилтүүд ирж байна 🌱' : 'Шинэ хэмжилт ирэхгүй байна. ESP32 болон Wi‑Fi холболтоо шалгаарай.', liveConnected ? 'info' : 'warn');
  }
  liveControls();
}
async function syncLive() {
  if (liveSyncing || liveBusy) return;
  liveSyncing = true;
  try {
    const hours = Number($('range').value);
    const [status, history] = await Promise.all([
      liveRequest('/api/status'), liveRequest('/api/history?hours=' + hours)
    ]);
    // A later range selection will be fetched after this in-flight request finishes.
    state.history = history.rows;
    acceptLive(status);
  } catch {
    liveConnected = false;
    document.querySelector('.top .pill').textContent = 'Сервертэй холбогдож чадсангүй';
    liveControls();
  } finally { liveSyncing = false; }
}
async function sendLiveCommand(id, action) {
  if (liveBusy || liveSyncing || !liveConnected) { toast('Түр хүлээгээрэй, төхөөрөмжийн төлөвийг шалгаж байна.'); return; }
  liveBusy = true;
  liveControls();
  try {
    const result = await liveRequest('/api/devices/' + id, { method: 'POST', body: JSON.stringify({ action }) });
    event(devices[id][0] + ' — үйлдэл биелснийг төхөөрөмж баталлаа.');
    acceptLive(result);
    toast('Боллоо! Төхөөрөмж үйлдлийг баталлаа ✓');
  } catch (error) {
    liveConnected = false;
    event('Үйлдэл биелсэн эсэх нь тодорхойгүй байна. Төхөөрөмжийн төлөвийг дахин шалгаж байна.', 'warn');
    toast('Үйлдэл баталгаажаагүй. ' + friendlyLiveError(error.message));
  } finally { liveBusy = false; liveControls(); void syncLive(); }
}
async function saveLiveSettings(settings) {
  if (liveBusy || liveSyncing || !liveConnected) { toast('Түр хүлээгээрэй, төхөөрөмжийн төлөвийг шалгаж байна.'); return; }
  liveBusy = true;
  liveControls();
  try {
    const result = await liveRequest('/api/settings', { method: 'POST', body: JSON.stringify(settings) });
    settingsDirty = false;
    acceptLive(result);
    $('settings-status').textContent = 'Төхөөрөмж шинэ тохиргоог хадгаллаа ✓';
  } catch (error) { toast('Тохиргоо хадгалагдсан эсэх нь тодорхойгүй байна. ' + friendlyLiveError(error.message)); }
  finally { liveBusy = false; liveControls(); void syncLive(); }
}
if (liveMode) {
  document.querySelector('.scenario').hidden = true;
  $('reset').hidden = true;
  $('range').insertAdjacentHTML('beforeend', '<option value="720">Сүүлийн 30 хоног</option>');
  const note = document.createElement('p');
  note.className = 'subtle';
  note.textContent = 'Энд хэмжилтүүдийг хугацаагаар нь нэгтгэж, дундаж утгаар харуулна. Эх хэмжилтүүд 30 хоног хадгалагдана.';
  $('history-chart').before(note);
  liveControls();
  void syncLive();
  setInterval(() => { if (!document.hidden) void syncLive(); }, 10000);
  $('range').addEventListener('change', async () => {
    while (liveSyncing) await new Promise(resolve => setTimeout(resolve, 100));
    void syncLive();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void syncLive(); });
}
