import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveQueueChannels } from '../src/discovery.js';
import { fillQueues, migrateOldSlots, refreshScheduledDescriptions } from '../src/queue.js';
import { deliveryKey } from '../src/core.js';
import { dailyVideoCount, isPlannedVideoSlot } from '../src/queue-schedule.js';

const FACEBOOK_ORIGINAL = '6ac8cdf16a5c39ccb6602776';
const FACEBOOK_SECOND = '6ad65667778b240e2f5bb5bc';
const INSTAGRAM = 'ig-1';
const now = new Date('2026-10-19T12:00:00Z');
const env = {
  BUFFER_ORGANIZATION_ID: 'org',
  BUFFER_FACEBOOK_CHANNEL_ID: FACEBOOK_ORIGINAL,
  BUFFER_FACEBOOK_CHANNEL_IDS: FACEBOOK_ORIGINAL + ',' + FACEBOOK_SECOND,
  BUFFER_INSTAGRAM_CHANNEL_ID: INSTAGRAM,
  R2_PUBLIC_BASE_URL: 'https://example.com'
};
const apiChannels = [
  { id: FACEBOOK_ORIGINAL, service: 'facebook', isQueuePaused: false },
  { id: FACEBOOK_SECOND, service: 'facebook', isQueuePaused: false },
  { id: INSTAGRAM, service: 'instagram', isQueuePaused: false }
];

test('identifie exactement les deux pages Facebook et Instagram', async () => {
  const result = await resolveQueueChannels(['facebook', 'instagram'], env, async () => ({ channels: apiChannels }));
  assert.deepEqual(result.channels.map(ch => ch.id), [FACEBOOK_ORIGINAL, FACEBOOK_SECOND, INSTAGRAM]);
  assert.deepEqual(result.channels.map(ch => ch.deliveryPlatform),
    ['facebook:' + FACEBOOK_ORIGINAL, 'facebook:' + FACEBOOK_SECOND, undefined]);
  assert.equal(result.env.BUFFER_FACEBOOK_CHANNEL_ID, FACEBOOK_ORIGINAL);
  await assert.rejects(resolveQueueChannels(['facebook'], {
    ...env, BUFFER_FACEBOOK_CHANNEL_IDS: FACEBOOK_ORIGINAL + ',missing'
  }, async () => ({ channels: apiChannels })), /absente/);
});

test('remplit 10 Reels sur chaque page sans confondre les checkpoints ni les horaires', async () => {
  const { channels } = await resolveQueueChannels(['facebook', 'instagram'], env, async () => ({ channels: apiChannels }));
  const posts = Array.from({ length: 50 }, (_, i) => ({
    id: 'p' + i, file: i + '.mp4', platforms: ['facebook', 'instagram']
  }));
  const state = { version: 1, slots: {}, deliveries: {} };
  const remote = [], sent = [];
  const options = { channels, posts, state, remote, env, now, targetQueueSize: 10,
    log: () => {}, persist: async () => {}, send: async input => {
      sent.push(input);
      return { status: 'queued', bufferId: 'sent-' + sent.length };
    }
  };
  const summaries = await fillQueues(options);
  assert.deepEqual(summaries.map(summary => summary.queued), [10, 10, 10]);
  assert.equal(sent.length, 30);
  for (const channel of channels) {
    assert.equal(sent.filter(p => p.channelId === channel.id).length, 10);
    assert.equal(dailyVideoCount(channel.deliveryPlatform || channel.service), 12);
    assert.ok(sent.filter(p => p.channelId === channel.id).every(p =>
      isPlannedVideoSlot(p.dueAt, channel.deliveryPlatform || channel.service)));
  }
  assert.notEqual(sent.find(p => p.channelId === FACEBOOK_ORIGINAL).dueAt,
    sent.find(p => p.channelId === FACEBOOK_SECOND).dueAt);
  assert.equal(state.deliveries[deliveryKey('p0', 'facebook:' + FACEBOOK_ORIGINAL)].channelId, FACEBOOK_ORIGINAL);
  assert.equal(state.deliveries[deliveryKey('p0', 'facebook:' + FACEBOOK_SECOND)].channelId, FACEBOOK_SECOND);
  assert.equal(state.deliveries[deliveryKey('p0', 'instagram')].channelId, INSTAGRAM);
  assert.deepEqual((await fillQueues(options)).map(s => s.added), [0, 0, 0]);
  assert.equal(sent.length, 30);
});

test('retient les anciennes publications Facebook seulement sur leur page', async () => {
  const { channels } = await resolveQueueChannels(['facebook', 'instagram'], env, async () => ({ channels: apiChannels }));
  const posts = Array.from({ length: 25 }, (_, i) => ({ id:'p'+i, file:i+'.mp4', platforms:['facebook','instagram'] }));
  const state = { version:1, slots:{}, deliveries:{
    [deliveryKey('p0', 'facebook:' + FACEBOOK_ORIGINAL)]: { status:'published', channelId:FACEBOOK_ORIGINAL }
  } };
  const sent=[];
  const summaries = await fillQueues({ state, posts, channels, env, now, remote:[], targetQueueSize: 10,
    log:()=>{}, persist:async()=>{}, send:async input=>{sent.push(input); return {status:'queued',bufferId:'b-'+sent.length};} });
  assert.deepEqual(summaries.map(s=>s.queued),[10,10,10]);
  assert.ok(sent.filter(p=>p.channelId===FACEBOOK_ORIGINAL).every(p=>!p.assets[0].video.url.endsWith('/0.mp4')));
  assert.ok(sent.some(p=>p.channelId===FACEBOOK_SECOND && p.assets[0].video.url.endsWith('/0.mp4')));
});

test('migraine et descriptions: cible le service facebook avec une cle distincte', async () => {
  const { channels } = await resolveQueueChannels(['facebook', 'instagram'], env, async () => ({ channels: apiChannels }));
  const source = { id: 'p0', file: '0.mp4', platforms: ['facebook', 'instagram'] };
  const state = { version:1, slots:{}, deliveries:{
    [deliveryKey('p0', 'facebook:' + FACEBOOK_SECOND)]: { status:'queued', bufferId:'b0', channelId:FACEBOOK_SECOND }
  } };
  const dueAt = '2026-10-19T15:45:00.000Z';
  const remote = [{ id:'b0', channelId:FACEBOOK_SECOND, status:'scheduled', dueAt, text:'old', assets:[{source:'https://example.com/0.mp4'}] }];
  let edits=0;
  const edit = async (id, nextDueAt, content) => {
    edits++;
    assert.equal(id,'b0');
    assert.ok(content.text);
    assert.equal(content.channelId, undefined);
    assert.equal(content.metadata?.facebook?.type, 'reel');
    return {status:'scheduled',dueAt:nextDueAt};
  };
  await migrateOldSlots({state,remote,channels,env,posts:[source],now,edit,persist:async()=>{}});
  await refreshScheduledDescriptions({state,remote,channels,env,posts:[source],edit,persist:async()=>{}});
  assert.ok(edits >= 1);
});
