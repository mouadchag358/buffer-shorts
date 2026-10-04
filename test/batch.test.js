import test from 'node:test';
import assert from 'node:assert/strict';
import { processTargets } from '../src/batch.js';
function setup(dryRun = false) {
  const state = { version: 1, slots: {}, deliveries: {} }, sent = [], checked = [];
  const posts = ['a', 'b'].map(id => ({ id, file: `${id}.mp4`, platforms: ['tiktok', 'youtube', 'instagram'] }));
  const targets = [{ key: 'night', dueAt: '2026-10-04T23:00:00Z' }, { key: 'morning', dueAt: '2026-10-05T01:00:00Z' }];
  return { state, sent, checked, options: { state, posts, targets, dryRun, log: () => {}, env: { R2_PUBLIC_BASE_URL: 'https://example.com', BUFFER_TIKTOK_CHANNEL_ID: 'tt', BUFFER_YOUTUBE_CHANNEL_ID: 'yt', BUFFER_INSTAGRAM_CHANNEL_ID: 'ig' }, persist: async () => {}, checkMedia: async url => checked.push(url), send: async input => { sent.push(input); return input.channelId === 'yt' ? { status: 'rejected', error: 'Video must be vertical for YouTube Shorts' } : { status: 'queued', bufferId: 'id' }; } } };
}
test('deux vidéos préparées et une relance sans envoi ou HEAD supplémentaire', async () => {
  const s = setup(); await processTargets(s.options);
  assert.deepEqual(s.state.slots, { night: 'a', morning: 'b' });
  assert.equal(s.sent.length, 6); assert.equal(s.checked.length, 2);
  assert.ok(s.sent.slice(0, 3).every(i => i.dueAt === s.options.targets[0].dueAt));
  assert.ok(s.sent.slice(3).every(i => i.dueAt === s.options.targets[1].dueAt));
  await processTargets(s.options); assert.equal(s.sent.length, 6); assert.equal(s.checked.length, 2);
});
test('simulation des deux vidéos distinctes sans enregistrer des envois fictifs', async () => {
  const s = setup(true), before = structuredClone(s.state);
  const result = await processTargets(s.options);
  assert.equal(result.length, 2); assert.deepEqual(s.checked, ['https://example.com/a.mp4', 'https://example.com/b.mp4']);
  assert.deepEqual(s.state, before); assert.equal(s.sent.length, 0);
});
test('un résultat incertain bloque le second créneau', async () => {
  const s = setup(); let calls = 0;
  s.options.send = async () => { calls++; throw new Error('timeout'); };
  await assert.rejects(processTargets(s.options), /uncertain/);
  assert.equal(calls, 1); assert.equal(s.checked.length, 1);
  await assert.rejects(processTargets(s.options), /incertain/); assert.equal(calls, 1);
});
