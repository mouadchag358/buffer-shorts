import test from 'node:test';
import assert from 'node:assert/strict';
import { nextPublication } from '../src/schedule.js';
import { discoverChannels } from '../src/discovery.js';
import { loadCatalog, postsFromKeys } from '../src/catalog.js';
import { processSlot } from '../src/core.js';
test('23h et 01h au Maroc, y compris pendant le changement de fuseau', () => {
  assert.deepEqual(nextPublication(new Date('2026-10-03T21:17:00Z'), true), { key: '2026-10-03-23h', dueAt: '2026-10-03T22:00:00.000Z' });
  assert.deepEqual(nextPublication(new Date('2026-10-03T23:17:00Z'), true), { key: '2026-10-04-01h', dueAt: '2026-10-04T00:00:00.000Z' });
  assert.equal(nextPublication(new Date('2026-02-28T22:17:00Z'), true).dueAt, '2026-02-28T23:00:00.000Z');
  assert.equal(nextPublication(new Date('2026-10-03T10:00:00Z'), true), null);
});
test('récupération des organisations et IDs liés avec refus des choix ambigus', async () => {
  const responses = [{ account: { organizations: [{ id: 'org' }] } }, { channels: [{ id: 'tt', service: 'tiktok' }, { id: 'yt', service: 'youtube' }, { id: 'ig', service: 'instagram' }] }];
  let calls = 0;
  const resolved = await discoverChannels(['tiktok', 'youtube', 'instagram'], {}, async () => responses[calls++]);
  assert.equal(calls, 2); assert.equal(resolved.BUFFER_INSTAGRAM_CHANNEL_ID, 'ig');
  await assert.rejects(discoverChannels(['tiktok'], { BUFFER_ORGANIZATION_ID: 'org' }, async () => ({ channels: [{ id: 'a', service: 'tiktok' }, { id: 'b', service: 'tiktok' }] })), /2 comptes/);
  await assert.rejects(discoverChannels(['tiktok'], {}, async () => ({ account: { organizations: [] } })), /organisations/);
});
test('listing R2 en cache, IDs stables, hashtags génériques et catalogue MP4 seul', async () => {
  const state = {}; let calls = 0, saves = 0;
  const options = { state, now: Date.parse('2026-10-03T08:00:00Z'), persist: async () => { saves++; }, list: async () => { calls++; assert.equal(state.r2ListingRequests.count, 1); return { Contents: [{ Key: 'عسل_تمارة.mp4' }, { Key: 'image.jpg' }] }; } };
  const posts = await loadCatalog(options); assert.equal(posts[0].title, '#fyp #fy #viral #ai'); assert.equal(posts.length, 1);
  await loadCatalog(options); assert.equal(calls, 1); assert.equal(saves, 2);
  assert.equal(posts[0].id, postsFromKeys(['other.mp4','عسل_تمارة.mp4']).find(p => p.file === 'عسل_تمارة.mp4').id);
});
test('budget R2 durable compte les erreurs et refuse les relances supplémentaires', async () => {
  const state = {}; let calls = 0;
  const options = { state, now: Date.parse('2026-10-03T08:00:00Z'), persist: async () => {}, list: async () => { calls++; throw new Error('failed'); } };
  await assert.rejects(loadCatalog(options)); options.now += 20000;
  await assert.rejects(loadCatalog(options)); options.now += 20000;
  await assert.rejects(loadCatalog(options), /Limite/); assert.equal(calls, 2);
});
test('429 et catalogue tronqué stoppent sans pagination ou relance', async () => {
  const now = Date.parse('2026-10-03T08:00:00Z'); const state = {};
  const options = { state, now, persist: async () => {}, list: async () => { throw { $metadata: { httpStatusCode: 429 } }; } };
  await assert.rejects(loadCatalog(options)); assert.equal(state.r2ListingRequests.pauseUntil, now + 3600000);
  await assert.rejects(loadCatalog({ ...options, now: now + 20000 }), /pause/);
  await assert.rejects(loadCatalog({ ...options, state: {}, list: async () => ({ IsTruncated: true }) }), /1000/);
});
test('les trois réseaux reçoivent la même date customScheduled', async () => {
  const posts = postsFromKeys(['vid.mp4']); const sent = [];
  const target = nextPublication(new Date('2026-10-03T21:17:00Z'));
  await processSlot({ posts, state: { version: 1, slots: {}, deliveries: {} }, slot: target.key, dueAt: target.dueAt,
    env: { R2_PUBLIC_BASE_URL: 'https://example.com', BUFFER_TIKTOK_CHANNEL_ID: 'tt', BUFFER_YOUTUBE_CHANNEL_ID: 'yt', BUFFER_INSTAGRAM_CHANNEL_ID: 'ig' }, persist: async () => {}, checkMedia: async () => {}, send: async input => { sent.push(input); return { status: 'queued', bufferId: 'ok' }; } });
  assert.equal(sent.length, 3); assert.ok(sent.every(i => i.mode === 'customScheduled' && i.dueAt === target.dueAt));
});
