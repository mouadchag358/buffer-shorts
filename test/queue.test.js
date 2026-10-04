import test from 'node:test';
import assert from 'node:assert/strict';
import { fillQueues, migrateOldSlots, reconcileDeliveries } from '../src/queue.js';
import { queueTargets, localParts, syncDue } from '../src/queue-schedule.js';
import { deliveryKey } from '../src/core.js';
import { queuedPosts, reschedulePost, createPost } from '../src/buffer.js';
const now = new Date('2026-10-04T12:00:00Z');
const channels = ['tiktok', 'instagram', 'youtube'].map(service => ({ service, id: service }));
function setup() {
  const state = { version: 1, slots: {}, deliveries: {} }, saved = [], sent = [];
  const env = { R2_PUBLIC_BASE_URL: 'https://example.com', ...Object.fromEntries(channels.map(c => [`BUFFER_${c.service.toUpperCase()}_CHANNEL_ID`, c.id])) };
  const posts = Array.from({ length: 20 }, (_, i) => ({ id: String(i), file: `${i}.mp4`, platforms: channels.map(c => c.service) }));
  return { state, saved, sent, env, posts, options: { posts, state, remote: [], channels, env, now, log: () => {}, persist: async s => saved.push(structuredClone(s)), send: async input => { assert.ok(saved.at(-1)); sent.push(input); return { status: 'queued', bufferId: `buffer-${sent.length}` }; } } };
}
test('3 vidéos par réseau, 00h et 02h, relance sans doublon ou ajout', async () => {
  const s = setup(); const summaries = await fillQueues(s.options);
  assert.equal(s.sent.length, 9); assert.ok(summaries.every(s => s.queued === 3));
  for (const channel of channels) {
    const items = s.sent.filter(i => i.channelId === channel.id);
    assert.deepEqual(items.map(i => i.dueAt), queueTargets(now).map(t => t.dueAt));
    assert.ok(items.every(i => ['00','02'].includes(localParts(new Date(i.dueAt)).hour)));
  }
  await fillQueues(s.options); assert.equal(s.sent.length, 9);
});
test('une publication libère une place sans republier la vidéo précédente', async () => {
  const s = setup(); await fillQueues(s.options);
  const removed = s.options.remote.shift(); s.options.now = new Date(removed.dueAt);
  const result = await fillQueues(s.options);
  assert.equal(s.sent.length, 10); assert.equal(result[0].added, 1);
  assert.notEqual(s.sent.at(-1).assets[0].video.url, s.sent[0].assets[0].video.url);
});
test('refus des Shorts horizontaux: 3 vidéos YouTube différentes, sans renvoi aux autres réseaux', async () => {
  const s = setup(); s.options.send = async input => {
    s.sent.push(input);
    return input.channelId === 'youtube' && /\/[01]\.mp4$/.test(input.assets[0].video.url)
      ? { status: 'rejected', error: 'Video must be vertical for YouTube Shorts' } : { status: 'queued', bufferId: `id-${s.sent.length}` };
  };
  const summaries = await fillQueues(s.options);
  assert.ok(summaries.every(s => s.queued === 3)); assert.equal(summaries[2].rejected, 2);
  assert.equal(s.sent.filter(i => i.channelId === 'tiktok').length, 3);
  const yt = s.sent.filter(i => i.channelId === 'youtube');
  assert.equal(yt[0].dueAt, yt[1].dueAt); assert.equal(yt[1].dueAt, yt[2].dueAt);
  await fillQueues(s.options); assert.equal(s.sent.length, 11);
});
test('refus non lié au format: arrêter ce réseau, continuer les suivants', async () => {
  const s = setup(); s.options.send = async input => { s.sent.push(input); return input.channelId === 'tiktok' ? { status: 'rejected', error: 'Queue full' } : { status: 'queued', bufferId: `id-${s.sent.length}` }; };
  const result = await fillQueues(s.options); assert.equal(result[0].attempts, 1);
  assert.equal(result[1].queued, 3); assert.equal(result[2].queued, 3);
});
test('budget borné même si tous les fichiers YouTube sont horizontaux', async () => {
  const s = setup(); s.options.send = async input => input.channelId === 'youtube'
    ? { status: 'rejected', error: 'Video must be vertical for YouTube Shorts' } : { status: 'queued', bufferId: `id-${Math.random()}` };
  const result = await fillQueues(s.options);
  assert.equal(result[2].attempts, 12); assert.equal(result.reduce((n,s) => n+s.attempts, 0), 18);
});
test('réponse incertaine et checkpoint échoué: aucun nouvel envoi', async () => {
  const s = setup(); s.options.send = async () => { throw new Error('timeout'); };
  await assert.rejects(fillQueues(s.options), /incertain/); assert.equal(s.state.deliveries[deliveryKey('0','tiktok')].status, 'uncertain');
  await assert.rejects(fillQueues(s.options), /incertain/);
  const t = setup(); t.options.persist = async () => { throw new Error('push failed'); };
  await assert.rejects(fillQueues(t.options), /push failed/); assert.equal(t.sent.length, 0);
});
test('simulation et comptes en pause: sans mutation durable', async () => {
  const s = setup(); const before = structuredClone(s.state);
  s.options.dryRun = true; s.options.channels = [{ ...channels[0], isQueuePaused: true }, ...channels.slice(1)];
  const result = await fillQueues(s.options);
  assert.deepEqual(s.state, before); assert.equal(s.sent.length+s.saved.length, 0);
  assert.equal(result[0].queued, 0); assert.equal(result[1].queued, 3);
});
test('posts externes comptés, collision évitée et source déjà présente réconciliée', async () => {
  const s = setup(), targets = queueTargets(now);
  s.options.remote.push({ id: 'external', channelId: 'tiktok', status: 'scheduled', dueAt: targets[0].dueAt, assets: [] });
  const result = await fillQueues(s.options);
  assert.equal(result[0].added, 2); assert.equal(s.sent[0].dueAt, targets[1].dueAt);
  const t = setup(); t.options.remote.push({ id: 'found', channelId: 'tiktok', status: 'scheduled', dueAt: targets[0].dueAt, assets: [{ source: 'https://example.com/0.mp4' }] });
  await fillQueues(t.options); assert.equal(t.state.deliveries[deliveryKey('0','tiktok')].bufferId, 'found');
  assert.equal(t.sent.filter(i=>i.channelId==='tiktok').length, 2);
});
test('réconciliation des statuts réel sent et error, sans remettre ces vidéos dans la file', async () => {
  const s = setup(); s.state.deliveries = { a: { status: 'queued', bufferId: 'sent' }, b: { status: 'queued', bufferId: 'error' }, c: { status: 'queued', bufferId: 'active' } };
  let reads = 0;
  await reconcileDeliveries({ state: s.state, now, persist: s.options.persist, remote: [{ id: 'active', status: 'scheduled', dueAt: now.toISOString() }], get: async id => { reads++; return { id, status: id, externalLink: 'https://example.com/post', error: { message: 'failed' } }; } });
  assert.equal(reads, 2); assert.equal(s.state.deliveries.a.status, 'published'); assert.equal(s.state.deliveries.b.status, 'failed_in_buffer');
});
test('12 heures réelles entre passages, indépendamment du jour local', () => {
  assert.equal(syncDue({}, now.getTime()), true);
  const state = { queueSync: { lastAttemptAt: now.toISOString() } };
  assert.equal(syncDue(state, now.getTime() + 12*3600000-1), false);
  assert.equal(syncDue(state, now.getTime() + 12*3600000), true);
});
function localTime(day, hour) {
  const nominal = Date.parse(`${day}T${hour}:00:00Z`);
  for (let offset = -180; offset<=180; offset++) {
    const date = new Date(nominal+offset*60000), p=localParts(date);
    if (`${p.year}-${p.month}-${p.day}` === day && p.hour === hour && p.minute === '00') return date;
  }
  throw new Error('Local time unavailable');
}
test('migration des anciens créneaux sans recréation, uniquement posts connus', async () => {
  const s = setup(); const dueAt = localTime('2026-10-04','23').toISOString();
  const remote = [{ id: 'owned', channelId: 'tiktok', status: 'scheduled', dueAt }, { id: 'external', channelId: 'instagram', status: 'scheduled', dueAt }];
  s.state.deliveries.a = { status: 'queued', bufferId: 'owned' }; let edits = 0;
  const options = { state: s.state, remote, channels, now, persist: s.options.persist, edit: async (id, date) => { edits++; assert.equal(id,'owned'); assert.equal(s.saved.at(-1).deliveries.a.scheduleUpdate.status,'pending'); return { id, status: 'scheduled', dueAt: date }; } };
  await migrateOldSlots(options); await migrateOldSlots(options);
  assert.equal(edits,1); assert.equal(localParts(new Date(remote[0].dueAt)).hour,'00'); assert.equal(remote[1].dueAt,dueAt);
});
test('API: édition ne remplace pas le média, pagination bloquée, création en draft signalée', async () => {
  await reschedulePost('id', now.toISOString(), {}, async (_, variables) => { assert.deepEqual(variables.input, { id:'id', dueAt:now.toISOString(), mode:'customScheduled', schedulingType:'automatic' }); return { editPost: { post: { id:'id',status:'scheduled',dueAt:now.toISOString() } } }; });
  await assert.rejects(queuedPosts('org',['id'],{},async()=>({ posts:{edges:[],pageInfo:{hasNextPage:true}} })), /100/);
  const fake = async()=>({ok:true,json:async()=>({data:{createPost:{post:{id:'draft',status:'draft'}}}})});
  assert.equal((await createPost({}, { BUFFER_API_KEY:'test' }, fake)).status,'uncertain');
});

test('post actif absent de la liste ajouté au comptage après lecture individuelle', async () => {
  const s = setup(), remote = [];
  s.state.deliveries[deliveryKey('0','tiktok')] = { status: 'queued', bufferId:'lagging' };
  await reconcileDeliveries({ state:s.state, remote, now, persist:s.options.persist, get:async()=>({id:'lagging',channelId:'tiktok',status:'scheduled',dueAt:queueTargets(now)[0].dueAt}) });
  s.options.remote = remote; const result = await fillQueues(s.options);
  assert.equal(result[0].queued,3); assert.equal(result[0].added,2);
});
