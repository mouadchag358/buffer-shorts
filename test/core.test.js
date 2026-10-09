import test from 'node:test';
import assert from 'node:assert/strict';
import { processSlot, inputFor, slotKey, validate, deliveryKey, videoTitle, youtubeTitle } from '../src/core.js';
import { createPost } from '../src/buffer.js';
const post = { id: 'a', file: 'a b.mp4', title: 'Test', platforms: ['tiktok', 'youtube'] };
const env = { BUFFER_TIKTOK_CHANNEL_ID: 'tt', BUFFER_YOUTUBE_CHANNEL_ID: 'yt', R2_PUBLIC_BASE_URL: 'https://media.example.com' };
function setup(overrides = {}) {
  const saved = [], sent = [];
  return { saved, sent, args: { posts: [structuredClone(post), { ...post, id: 'b' }], state: { version: 1, slots: {}, deliveries: {} }, slot: '2026-10-03-morning', env,
    persist: async s => saved.push(structuredClone(s)), checkMedia: async () => {},
    send: async input => { sent.push(input); return { status: 'queued', bufferId: `id${sent.length}` }; }, ...overrides } };
}
test('un créneau traite une vidéo, une fois par réseau', async () => {
  const { args, sent, saved } = setup(); await processSlot(args); await processSlot(args);
  assert.equal(sent.length, 2); assert.equal(saved.length, 4);
  assert.equal(saved[0].deliveries[deliveryKey('a', 'tiktok')].status, 'sending');
  args.slot = '2026-10-03-evening'; await processSlot(args); assert.equal(sent.length, 4);
});
test('interruption: les nouvelles tentatives sont bloquées', async () => {
  const { args } = setup({ send: async () => { throw new Error('timeout'); } });
  await assert.rejects(processSlot(args), /uncertain/); await assert.rejects(processSlot(args), /incertain/);
});
test('échec du checkpoint: aucun appel API', async () => {
  const { args, sent } = setup({ persist: async () => { throw new Error('push failed'); } });
  await assert.rejects(processSlot(args)); assert.equal(sent.length, 0);
});
test('rejet YouTube: TikTok ne sera pas renvoyé', async () => {
  const { args, sent } = setup(); let fail = true;
  args.send = async input => { sent.push(input.channelId); return fail && input.channelId === 'yt' ? { status: 'rejected', error: 'Queue full' } : { status: 'queued', bufferId: 'ok' }; };
  await assert.rejects(processSlot(args), /rejected/); fail = false;
  await processSlot(args); assert.deepEqual(sent, ['tt', 'yt', 'yt']);
});
test('simulation sans mutation ou réseau', async () => {
  const { args, saved, sent } = setup({ dryRun: true, checkMedia: async () => { throw new Error(); } });
  const before = JSON.stringify(args.state); assert.equal((await processSlot(args)).length, 2);
  assert.equal(JSON.stringify(args.state), before); assert.equal(saved.length + sent.length, 0);
});
test('prévalidation des destinations avant envoi', async () => {
  const { args, sent, saved } = setup({ env: { ...env, BUFFER_YOUTUBE_CHANNEL_ID: '' } });
  await assert.rejects(processSlot(args), /Channel ID/); assert.equal(sent.length + saved.length, 0);
});
test('URL encodée et titre/catégorie YouTube', () => {
  const input = inputFor(post, 'youtube', env);
  assert.equal(input.assets[0].video.url, 'https://media.example.com/a%20b.mp4');
  assert.equal(input.metadata.youtube.title, 'Test 👀 #Shorts'); assert.equal(input.metadata.youtube.categoryId, '22');
});
test('validation et créneaux UTC', () => {
  assert.throws(() => validate([post, post]));
  assert.throws(() => validate([{ ...post, platforms: ['unknown'] }]));
  assert.equal(slotKey(new Date('2026-10-03T07:17:00Z')), '2026-10-03-morning');
  assert.equal(slotKey(new Date('2026-10-03T19:17:00Z')), '2026-10-03-evening');
});
test('Buffer distingue succès, rejet et résultat incertain', async () => {
  const fake = body => async () => ({ ok: true, json: async () => body }); const key = { BUFFER_API_KEY: 'test-only' };
  assert.equal((await createPost({}, key, fake({ data: { createPost: { post: { id: 'p' } } } }))).bufferId, 'p');
  assert.equal((await createPost({}, key, fake({ data: { createPost: { message: 'Queue full' } } }))).status, 'rejected');
  await assert.rejects(createPost({}, key, async () => ({ ok: false, status: 502 })));
  await assert.rejects(createPost({}, key, fake({ errors: [{ message: 'invalid' }] })));
});

test('titres des fichiers avec priorité au titre personnalisé', () => {
  assert.equal(videoTitle({ file: 'folder/vid.mp4' }), 'vid');
  assert.equal(videoTitle({ url: 'https://example.com/Mon%20titre_%C3%A9t%C3%A9.mp4' }), 'Mon titre été');
  assert.equal(videoTitle({ title: '  Mon titre  ' }), 'Mon titre');
  assert.equal(videoTitle({ title: 'Autre', youtube: { title: 'Spécifique' } }), 'Spécifique');
});
test('YouTube utilise le titre du fichier par défaut et ajoute #Shorts', () => {
  const p = { ...post, title: '', file: 'Mon_short.mp4' };
  validate([p]); const input = inputFor(p, 'youtube', env);
  assert.equal(input.metadata.youtube.title, 'Mon short 👀 #Shorts');
  assert.match(input.text, /#Shorts|#YouTubeShorts/);
  assert.ok(youtubeTitle({ ...p, title: 'a'.repeat(101) }).length <= 100);
});

test('titres arabes et limite YouTube sans couper un emoji', () => {
  assert.equal(videoTitle({ file: 'عسل_تمارة.mp4' }), 'عسل تمارة');
  assert.equal(videoTitle({ file: 'a'.repeat(99) + '🍯.mp4' }).length, 99);
});

test('miniature Instagram à 1 seconde seulement', () => {
  const instagram = inputFor(post, 'instagram', { ...env, BUFFER_INSTAGRAM_CHANNEL_ID: 'ig' });
  assert.equal(instagram.assets[0].video.metadata.thumbnailOffset, 1000);
  for (const platform of ['youtube', 'tiktok']) {
    assert.equal(inputFor(post, platform, env).assets[0].video.metadata, undefined);
  }
});

test('les vidéos Facebook sont programmées comme Reels', () => {
  const input = inputFor({ id: 'fb', file: 'video.mp4', platforms: ['facebook'] }, 'facebook',
    { BUFFER_FACEBOOK_CHANNEL_ID: 'page', R2_PUBLIC_BASE_URL: 'https://example.com' });
  assert.equal(input.channelId, 'page');
  assert.deepEqual(input.metadata, { facebook: { type: 'reel' } });
  assert.equal(input.assets[0].video.metadata, undefined);
});
