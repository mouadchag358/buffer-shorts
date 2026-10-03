import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaChecker } from '../src/media.js';
const start = Date.parse('2026-10-03T08:00:00Z');
const good = { status: 200, ok: true, headers: new Headers({ 'content-type': 'video/mp4' }) };
function setup(state = {}) {
  let time = start, calls = 0;
  const saves = [];
  return { state, saves, get calls() { return calls; }, advance(ms) { time += ms; }, options: { state, now: () => time, persist: async s => saves.push(structuredClone(s)), fetcher: async (_url, options) => { calls++; assert.equal(saves.at(-1).mediaRequests.count, state.mediaRequests.count); assert.equal(options.redirect, 'error'); return good; } } };
}
test('une seule requête par exécution, sauvegardée avant le réseau', async () => {
  const s = setup(), check = mediaChecker(s.options);
  await check('https://example.com/a.mp4'); s.advance(20000);
  await assert.rejects(check('https://example.com/b.mp4'), /Limite R2/); assert.equal(s.calls, 1);
});
test('quatre requêtes quotidiennes même avec de nouveaux processus', async () => {
  const s = setup();
  for (let i = 0; i < 4; i++) { await mediaChecker(s.options)('https://example.com/a.mp4'); s.advance(20000); }
  await assert.rejects(mediaChecker(s.options)('https://example.com/a.mp4'), /Limite R2/); assert.equal(s.calls, 4);
  s.advance(86400000); await mediaChecker(s.options)('https://example.com/a.mp4'); assert.equal(s.state.mediaRequests.count, 1);
});
test('échec réseau compté, aucune nouvelle tentative et aucun appel si sauvegarde échoue', async () => {
  const s = setup(); let attempts = 0;
  await assert.rejects(mediaChecker({ ...s.options, fetcher: async () => { attempts++; throw new Error('timeout'); } })('https://example.com/a.mp4'));
  assert.equal(attempts, 1); assert.equal(s.state.mediaRequests.count, 1);
  s.advance(20000);
  await assert.rejects(mediaChecker({ ...s.options, persist: async () => { throw new Error('push failed'); } })('https://example.com/a.mp4'));
  assert.equal(s.calls, 0);
});
test('429 conserve une pause Retry-After entre les exécutions et les jours', async () => {
  const s = setup();
  await assert.rejects(mediaChecker({ ...s.options, fetcher: async () => ({ status: 429, headers: new Headers({ 'retry-after': '172800' }) }) })('https://example.com/a.mp4'), /429/);
  s.advance(86400000); await assert.rejects(mediaChecker(s.options)('https://example.com/a.mp4'), /pause/);
  assert.equal(s.calls, 0);
});
test('intervalle minimum et compteur invalide bloquent le réseau', async () => {
  const s = setup(); await mediaChecker(s.options)('https://example.com/a.mp4');
  await assert.rejects(mediaChecker(s.options)('https://example.com/a.mp4'), /rapprochées/);
  s.state.mediaRequests.count = 'invalid'; s.advance(20000);
  await assert.rejects(mediaChecker(s.options)('https://example.com/a.mp4'), /invalide/); assert.equal(s.calls, 1);
});
