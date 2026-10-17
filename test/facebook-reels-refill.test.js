import test from 'node:test';
import assert from 'node:assert/strict';
import { fillQueues } from '../src/queue.js';
import { deliveryKey } from '../src/core.js';
const now = new Date('2026-10-17T18:00:00.000Z');

test('Facebook skips dozens of incompatible videos and fills 8 without retrying rejects', async () => {
  const posts = Array.from({ length: 60 }, (_, i) => ({ id: 'fb'+i, file: i+'.mp4', platforms:['facebook'] }));
  const state = { version:1, slots:{}, deliveries:{} };
  const remote = [];
  const sent = [];
  const options = {
    posts, state, remote, now, channels:[{ id:'fb',service:'facebook' }],
    env:{ BUFFER_FACEBOOK_CHANNEL_ID:'fb', R2_PUBLIC_BASE_URL:'https://example.com' },
    persist:async()=>{}, log:()=>{},
    send:async input=>{
      sent.push(input);
      const n = Number(input.assets[0].video.url.match(/\/(\d+)\.mp4$/)[1]);
      return n < 25
        ? { status:'rejected', error:'Invalid post: Video height must be at least 960px for Facebook Reels.' }
        : { status:'queued', bufferId:'accepted-'+n };
    }
  };
  const first = await fillQueues(options);
  assert.equal(first[0].queued,8);
  assert.equal(first[0].rejected,25);
  assert.equal(first[0].added,8);
  assert.equal(sent.length,33);
  assert.equal(state.deliveries[deliveryKey('fb0','facebook')].status,'rejected');
  await fillQueues(options);
  assert.equal(sent.length,33);
});
