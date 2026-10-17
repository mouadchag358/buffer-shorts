import test from 'node:test';
import assert from 'node:assert/strict';
import { fillQueues } from '../src/queue.js';
import { isPlannedVideoSlot, dailyVideoCount, platformQueueTargets } from '../src/queue-schedule.js';

test('production can keep exactly 10 videos ready per network with stable daily random slots', async () => {
  const channels = ['facebook','instagram','youtube'].map(service => ({ id:service,service }));
  const env = { R2_PUBLIC_BASE_URL:'https://example.com',
    BUFFER_FACEBOOK_CHANNEL_ID:'facebook', BUFFER_INSTAGRAM_CHANNEL_ID:'instagram',
    BUFFER_YOUTUBE_CHANNEL_ID:'youtube' };
  const posts = Array.from({length:16},(_,i)=>({
    id:'video-'+i,file:'video-'+i+'.mp4',platforms:['facebook','instagram','youtube']
  }));
  const state = {version:1, slots:{}, deliveries:{}};
  const remote=[],sent=[];
  const now = new Date('2026-10-17T20:00:00Z');
  const options = {channels,posts,state,env,remote,now,targetQueueSize:10,
    persist:async()=>{},log:()=>{},send:async input=>{
      sent.push(input);return {status:'queued',bufferId:'buffer-'+sent.length};
    }};
  const first=await fillQueues(options);
  assert.deepEqual(first.map(x=>x.queued),[10,10,10]);
  assert.deepEqual(first.map(x=>x.added),[10,10,10]);
  assert.equal(sent.length,30);
  for(const platform of ['facebook','instagram','youtube']){
    assert.equal(remote.filter(x=>x.channelId===platform).length,10);
    assert.equal(dailyVideoCount(platform),platform==='youtube'?4:12);
    const timings = sent.filter(x=>x.channelId===platform).map(x=>x.dueAt);
    assert.deepEqual(timings, platformQueueTargets(now,platform,10).map(x=>x.dueAt));
    assert.ok(timings.every(x=>isPlannedVideoSlot(x,platform)));
  }
  const again=await fillQueues(options);
  assert.deepEqual(again.map(x=>x.added),[0,0,0]);
  assert.equal(sent.length,30);
  await assert.rejects(fillQueues({...options,targetQueueSize:11}),/maximum 10/);
});
