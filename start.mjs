import { createGreenhouse } from './server.mjs';
const app = await createGreenhouse({
  live: process.env.GREENHOUSE_MODE === 'live',
  espUrl: process.env.ESP32_URL || '',
  espToken: process.env.ESP32_TOKEN || ''
});
const port = Number(process.env.PORT || 8080);
app.server.listen(port, '127.0.0.1', () => console.log('Greenhouse: http://127.0.0.1:' + port));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => { await app.close(); process.exit(0); });
}
