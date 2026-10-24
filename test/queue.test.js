import test from 'node:test';
import assert from 'node:assert/strict';
import { fillQueues, initFacebookFromInstagram, migrateOldSlots, reconcileDeliveries, refreshScheduledDescriptions } from '../src/queue.js';
import { queueTargets, platformQueueTargets, localParts, isPlannedVideoSlot, syncDue, videoHourKey, dailyVideoCount } from '../src/queue-schedule.js';
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
test('8 vidéos en avance: Facebook, Instagram, YouTube et TikTok 4 par jour', async () => {
  const s = setup(); const summaries = await fillQueues(s.options);
  assert.equal(s.sent.length, 24); assert.ok(summaries.every(s => s.queued === 8));
  for (const channel of channels) {
    const items = s.sent.filter(i => i.channelId === channel.id);
    assert.deepEqual(items.map(i => i.dueAt), platformQueueTargets(now, channel.service, 8).map(t => t.dueAt));
    assert.ok(items.every(i => isPlannedVideoSlot(i.dueAt, channel.service)));
  }
  await fillQueues(s.options); assert.equal(s.sent.length, 24);
});
test('une publication libère une place sans republier la vidéo précédente', async () => {
  const s = setup(); await fillQueues(s.options);
  const removed = s.options.remote.shift(); s.options.now = new Date(removed.dueAt);
  const result = await fillQueues(s.options);
  assert.equal(s.sent.length, 25); assert.equal(result[0].added, 1);
  assert.notEqual(s.sent.at(-1).assets[0].video.url, s.sent[0].assets[0].video.url);
});
test('refus des Shorts horizontaux: 8 vidéos YouTube différentes, sans renvoi aux autres réseaux', async () => {
  const s = setup(); s.options.send = async input => {
    s.sent.push(input);
    return input.channelId === 'youtube' && /\/[01]\.mp4$/.test(input.assets[0].video.url)
      ? { status: 'rejected', error: 'Video must be vertical for YouTube Shorts' } : { status: 'queued', bufferId: `id-${s.sent.length}` };
  };
  const summaries = await fillQueues(s.options);
  assert.ok(summaries.every(s => s.queued === 8)); assert.equal(summaries[2].rejected, 2);
  assert.equal(s.sent.filter(i => i.channelId === 'tiktok').length, 8);
  const yt = s.sent.filter(i => i.channelId === 'youtube');
  assert.equal(yt[0].dueAt, yt[1].dueAt); assert.equal(yt[1].dueAt, yt[2].dueAt);
  await fillQueues(s.options); assert.equal(s.sent.length, 26);
});

test('Instagram: ignorer les Reels sous 23 fps, remplir la file sans retenter les rejets', async () => {
  const s = setup();
  s.options.send = async input => {
    s.sent.push(input);
    return input.channelId === 'instagram' && /\/[01]\.mp4$/.test(input.assets[0].video.url)
      ? { status: 'rejected', error: 'Invalid post: Video frame rate must be at least 23 fps for Instagram Reels.' }
      : { status: 'queued', bufferId: `id-${s.sent.length}` };
  };
  const summaries = await fillQueues(s.options);
  assert.ok(summaries.every(summary => summary.queued === 8));
  assert.equal(summaries[1].rejected, 2);
  assert.equal(summaries[1].added, 8);
  assert.equal(s.sent.filter(input => input.channelId === 'instagram').length, 10);
  assert.equal(s.state.deliveries[deliveryKey('0','instagram')].status, 'rejected');
  await fillQueues(s.options);
  assert.equal(s.sent.length, 26);
});

test('refus non lié au format: arrêter ce réseau, continuer les suivants', async () => {
  const s = setup(); s.options.send = async input => { s.sent.push(input); return input.channelId === 'tiktok' ? { status: 'rejected', error: 'Queue full' } : { status: 'queued', bufferId: `id-${s.sent.length}` }; };
  const result = await fillQueues(s.options); assert.equal(result[0].attempts, 1);
  assert.equal(result[1].queued, 8); assert.equal(result[2].queued, 8);
});
test('budget borné même si tous les fichiers YouTube sont horizontaux', async () => {
  const s = setup(); s.options.send = async input => input.channelId === 'youtube'
    ? { status: 'rejected', error: 'Video must be vertical for YouTube Shorts' } : { status: 'queued', bufferId: `id-${Math.random()}` };
  const result = await fillQueues(s.options);
  assert.equal(result[2].attempts, 12); assert.equal(result.reduce((n,s) => n+s.attempts, 0), 28);
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
  assert.equal(result[0].queued, 0); assert.equal(result[1].queued, 8);
});
test('posts externes comptés, collision évitée et source déjà présente réconciliée', async () => {
  const s = setup(), targets = platformQueueTargets(now, 'tiktok');
  s.options.remote.push({ id: 'external', channelId: 'tiktok', status: 'scheduled', dueAt: targets[0].dueAt, assets: [] });
  const result = await fillQueues(s.options);
  assert.equal(result[0].added, 7); assert.equal(s.sent[0].dueAt, targets[1].dueAt);
  const t = setup(); t.options.remote.push({ id: 'found', channelId: 'tiktok', status: 'scheduled', dueAt: targets[0].dueAt, assets: [{ source: 'https://example.com/0.mp4' }] });
  await fillQueues(t.options); assert.equal(t.state.deliveries[deliveryKey('0','tiktok')].bufferId, 'found');
  assert.equal(t.sent.filter(i=>i.channelId==='tiktok').length, 7);
});
test('réconciliation des statuts réel sent et error, sans remettre ces vidéos dans la file', async () => {
  const s = setup(); s.state.deliveries = { a: { status: 'queued', bufferId: 'sent' }, b: { status: 'queued', bufferId: 'error' }, c: { status: 'queued', bufferId: 'active' } };
  let reads = 0;
  await reconcileDeliveries({ state: s.state, now, persist: s.options.persist, remote: [{ id: 'active', status: 'scheduled', dueAt: now.toISOString() }], get: async id => { reads++; return { id, status: id, externalLink: 'https://example.com/post', error: { message: 'failed' } }; } });
  assert.equal(reads, 2); assert.equal(s.state.deliveries.a.status, 'published'); assert.equal(s.state.deliveries.b.status, 'failed_in_buffer');
});
test('6 heures réelles entre passages, indépendamment du jour local', () => {
  assert.equal(syncDue({}, now.getTime()), true);
  const state = { queueSync: { lastAttemptAt: now.toISOString() } };
  assert.equal(syncDue(state, now.getTime() + 6*3600000-1), false);
  assert.equal(syncDue(state, now.getTime() + 6*3600000), true);
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
  const s = setup(); const dueAt = new Date(localTime('2026-10-05','02').getTime() + 20 * 60000).toISOString();
  const remote = [{ id: 'owned', channelId: 'tiktok', status: 'scheduled', dueAt }, { id: 'external', channelId: 'instagram', status: 'scheduled', dueAt }];
  s.state.deliveries[deliveryKey('0','tiktok')] = { status: 'queued', bufferId: 'owned' }; let edits = 0;
  const options = { state: s.state, remote, channels, now, posts: s.posts, env: s.env, persist: s.options.persist, edit: async (id, date, content) => { edits++; assert.equal(id,'owned'); assert.equal(s.saved.at(-1).deliveries[deliveryKey('0','tiktok')].scheduleUpdate.status,'pending'); assert.equal(content.assets[0].video.url,'https://example.com/0.mp4'); assert.ok(content.text); assert.equal(content.channelId,undefined); assert.equal(content.needsApproval,undefined); return { id, status: 'scheduled', dueAt: date }; } };
  await migrateOldSlots(options); await migrateOldSlots(options);
  assert.equal(edits,1); assert.ok(isPlannedVideoSlot(remote[0].dueAt, 'tiktok')); assert.equal(remote[1].dueAt,dueAt);
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
  await reconcileDeliveries({ state:s.state, remote, now, persist:s.options.persist, get:async()=>({id:'lagging',channelId:'tiktok',status:'scheduled',dueAt:platformQueueTargets(now,'tiktok')[0].dueAt}) });
  s.options.remote = remote; const result = await fillQueues(s.options);
  assert.equal(result[0].queued,8); assert.equal(result[0].added,7);
});

test('12 horaires aléatoires/stables Facebook et Instagram, 4 pour YouTube, y compris pendant Ramadan', () => {
  const dates = [
    ['2026-10-04T12:00:00Z','2026-10-05'],
    ['2026-02-19T12:00:00Z','2026-02-20']
  ];
  assert.equal(dailyVideoCount('facebook'), 12);
  assert.equal(dailyVideoCount('instagram'), 12);
  assert.equal(dailyVideoCount('youtube'), 4);
  for (const [startIso, targetDay] of dates) {
    const start = new Date(startIso);
    for (const platform of ['facebook', 'instagram', 'youtube']) {
      const slots = platformQueueTargets(start, platform, 32);
      assert.deepEqual(slots, platformQueueTargets(start, platform, 32));
      assert.ok(slots.every(slot => isPlannedVideoSlot(slot.dueAt, platform)));
      const fullDay = slots.filter(slot => {
        const p = localParts(new Date(slot.dueAt));
        return `${p.year}-${p.month}-${p.day}` === targetDay;
      });
      const count = dailyVideoCount(platform);
      assert.equal(fullDay.length, count);
      assert.equal(new Set(fullDay.map(s => videoHourKey(s.dueAt))).size, count);
      for (let index = 0; index < fullDay.length; index++) {
        const p = localParts(new Date(fullDay[index].dueAt));
        assert.equal(Number(p.minute) % 5, 0);
        if (count === 12) {
          assert.ok(Number(p.hour) >= index * 2 && Number(p.hour) < (index + 1) * 2);
        }
      }
    }
    assert.deepEqual(queueTargets(start), platformQueueTargets(start, 'instagram'));
  }
});
test('le prochain créneau du jour reste accessible après une synchro, sans attendre demain', () => {
  const now = new Date('2026-10-17T12:00:00Z');
  const slots = platformQueueTargets(now, 'facebook', 8);
  assert.ok(slots.some(s => {
    const p = localParts(new Date(s.dueAt));
    return `${p.year}-${p.month}-${p.day}` === '2026-10-17';
  }));
  assert.ok(slots.every(s => Date.parse(s.dueAt) > now.getTime() + 10 * 60000));
});
test('migration de plusieurs anciennes vidéos vers des créneaux distincts', async () => {
  const s = setup();
  const remote = [['00',20],['02',40]].map(([hour, minute], i) => ({ id: 'old-' + i, channelId:'tiktok', status:'scheduled', dueAt:new Date(localTime('2026-10-05',hour).getTime() + minute * 60000).toISOString() }));
  remote.forEach((p,i) => { s.state.deliveries[deliveryKey(String(i),'tiktok')] = {status:'queued',bufferId:p.id}; });
  await migrateOldSlots({state:s.state,remote,channels,now,posts:s.posts,env:s.env,persist:s.options.persist,edit:async(id,dueAt)=>({id,dueAt,status:'scheduled'})});
  assert.deepEqual(remote.map(p=>p.dueAt),platformQueueTargets(now,'tiktok',2).map(t=>t.dueAt));
});

test('Facebook reprend exactement les quatre créneaux quotidiens Instagram avec huit Reels en avance', async () => {
  const channel = { id: 'facebook', service: 'facebook' };
  const state = { version: 1, slots: {}, deliveries: {} }, sent = [];
  const env = { BUFFER_FACEBOOK_CHANNEL_ID: 'facebook', R2_PUBLIC_BASE_URL: 'https://example.com' };
  const posts = Array.from({ length: 12 }, (_, i) => ({ id: 'fb-' + i, file: 'fb-' + i + '.mp4', platforms: ['facebook'] }));
  const options = { posts, state, remote: [], channels: [channel], env, now, persist: async () => {}, log: () => {},
    send: async input => { sent.push(input); return { status: 'queued', bufferId: 'fb-' + sent.length }; } };
  const summaries = await fillQueues(options);
  assert.equal(summaries[0].queued, 8);
  assert.equal(sent.length, 8);
  assert.deepEqual(sent.map(p => p.dueAt), platformQueueTargets(now, 'facebook', 8).map(t => t.dueAt));
  assert.ok(sent.every(p => p.metadata?.facebook?.type === 'reel'));
  await fillQueues(options);
  assert.equal(sent.length, 8);
});

test('reprendre Facebook à la dernière vidéo réellement publiée sur Instagram', async () => {
  const posts = Array.from({ length: 15 }, (_, i) => ({ id: 'video-' + i, file: 'video-' + i + '.mp4', platforms: ['instagram','facebook'] }));
  const state = { version: 1, slots: {}, deliveries: {
    [deliveryKey('video-9', 'instagram')]: { status: 'published', sentAt: '2026-10-07T00:00:00Z' },
    [deliveryKey('video-2', 'instagram')]: { status: 'published', sentAt: '2026-10-09T10:01:04Z' },
    [deliveryKey('video-3', 'instagram')]: { status: 'queued', bufferId: 'already-scheduled', dueAt: now.toISOString() }
  } };
  const sent = [], saved = [];
  const options = { posts, state, channels: [{ service:'facebook',id:'fb' }], remote: [], env: {
    BUFFER_FACEBOOK_CHANNEL_ID:'fb',R2_PUBLIC_BASE_URL:'https://example.com'
  }, now, persist: async s => saved.push(structuredClone(s)), log: () => {},
  send: async input => { sent.push(input); return { status:'queued',bufferId:'fb-'+sent.length }; } };
  const result = await fillQueues(options);
  assert.equal(result[0].queued, 8);
  assert.deepEqual(sent.slice(0,1).map(x=>x.assets[0].video.url),['https://example.com/video-3.mp4']);
  assert.ok(!sent.some(x=>/video-9.mp4/.test(x.assets[0].video.url)));
  assert.equal(state.resume.facebookFromInstagram.lastInstagramPostId,'video-2');
  assert.ok(state.resume.facebookFromInstagram.skippedPostIds.includes('video-9'));
  assert.ok(saved.length >= 1);
  await fillQueues(options);
  assert.equal(sent.length, 8);
  // Historical marker cannot be recalculated when newer Instagram posts go live.
  state.deliveries[deliveryKey('video-12', 'instagram')]={ status:'published', sentAt:'2026-10-10T00:00:00Z' };
  const checkpoint = await initFacebookFromInstagram({ posts, state, persist: async()=>{} });
  assert.equal(checkpoint.lastInstagramPostId, 'video-2');
});

test('ignore les anciennes chaînes TikTok et garde les posts Buffer introuvables sans les republier', async () => {
  const state = { version: 1, slots: {}, deliveries: {
    [deliveryKey('old','tiktok')]: { status:'queued', bufferId:'old-tiktok', channelId:'tt' },
    [deliveryKey('gone','instagram')]: { status:'queued', bufferId:'missing-ig', channelId:'ig' },
    [deliveryKey('fine','instagram')]: { status:'queued', bufferId:'valid-ig', channelId:'ig' }
  }};
  let calls=0, saves=0;
  await reconcileDeliveries({ state, remote: [], channels:[{id:'ig',service:'instagram'}], now,
    persist: async()=>{saves++}, get: async id=>{
      calls++;
      if(id==='old-tiktok') throw Error('Ne doit pas être interrogé');
      if(id==='missing-ig') { const error = Error('Ancien post absent'); error.code='BUFFER_POST_NOT_FOUND'; throw error; }
      return {id,status:'sent',sentAt:now.toISOString()};
    }});
  assert.equal(calls,2);
  assert.equal(state.deliveries[deliveryKey('old','tiktok')].status,'queued');
  assert.equal(state.deliveries[deliveryKey('gone','instagram')].status,'missing_in_buffer');
  assert.equal(state.deliveries[deliveryKey('fine','instagram')].status,'published');
  assert.ok(saves>=2);
});

test('Facebook saute les vidéos trop petites sans renvoi ni blocage de la file', async () => {
  const posts = Array.from({ length: 12 }, (_, i) => ({ id:'f'+i, file:i+'.mp4', platforms:['facebook'] }));
  const state={version:1,slots:{},deliveries:{},resume:{facebookFromInstagram:{lastInstagramPostId:'f-start',lastInstagramSentAt:'2026-10-09T10:00:00Z',skippedPostIds:[]}}};
  const sends=[];const opts={posts,state,remote:[],channels:[{id:'fb',service:'facebook'}],env:{BUFFER_FACEBOOK_CHANNEL_ID:'fb',R2_PUBLIC_BASE_URL:'https://example.com'},now,persist:async()=>{},log:()=>{},
    send:async input=>{sends.push(input);return /\/0\.mp4$|\/1\.mp4$/.test(input.assets[0].video.url)?{status:'rejected',error:'Invalid post: Video height must be at least 960px for Facebook Reels.'}:{status:'queued',bufferId:'fb-'+sends.length}}};
  const result=await fillQueues(opts);
  assert.equal(result[0].queued,8);assert.equal(result[0].rejected,2);assert.equal(sends.length,10);
  await fillQueues(opts);assert.equal(sends.length,10);
});

test('Facebook ignore les Reels de plus de 90 secondes sans les retenter', async () => {
  const posts = Array.from({ length: 14 }, (_, i) => ({ id: 'duration-' + i, file: i + '.mp4', platforms: ['facebook'] }));
  const state = { version: 1, slots: {}, deliveries: {} };
  const sent = [];
  const options = {
    posts, state, remote: [], channels: [{ id: 'fb', service: 'facebook' }],
    env: { BUFFER_FACEBOOK_CHANNEL_ID: 'fb', R2_PUBLIC_BASE_URL: 'https://example.com' },
    now, persist: async () => {}, log: () => {},
    send: async input => {
      sent.push(input);
      const url = input.assets[0].video.url;
      return (url.endsWith('/0.mp4') || url.endsWith('/1.mp4'))
        ? { status: 'rejected', error: 'Invalid post: Video must be no longer than 1m 30s for Facebook Reels.' }
        : { status: 'queued', bufferId: 'fb-' + sent.length };
    }
  };
  const result = await fillQueues(options);
  assert.equal(result[0].queued, 8);
  assert.equal(result[0].rejected, 2);
  assert.equal(result[0].errors.length, 0);
  assert.equal(sent.length, 10);
  assert.equal(state.deliveries[deliveryKey('duration-0', 'facebook')].status, 'rejected');
  await fillQueues(options);
  assert.equal(sent.length, 10);
});

test('Facebook captions are updated on already scheduled Buffer Reels, without resending videos', async () => {
  const post = { id: 'clip-fb', file: 'clip-fb.mp4', title: 'Original title', text: 'Old caption', platforms: ['facebook'] };
  const env = { R2_PUBLIC_BASE_URL: 'https://example.com', BUFFER_FACEBOOK_CHANNEL_ID: 'fb' };
  const remote = [{ id: 'buffer-fb', channelId: 'fb', status: 'scheduled', dueAt: now.toISOString(), text: 'Old caption' }];
  const state = { deliveries: { [deliveryKey(post.id, 'facebook')]: { status: 'queued', bufferId: 'buffer-fb' } } };
  const edits = []; let saves = 0;
  const opts = { posts: [post], state, remote, channels: [{ id: 'fb', service: 'facebook' }], env,
    persist: async () => { saves++; }, edit: async (id, dueAt, content) => {
      edits.push({ id, dueAt, content });
      return { id, status: 'scheduled', dueAt };
    } };
  assert.equal(await refreshScheduledDescriptions(opts), 1);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].id, 'buffer-fb');
  assert.equal(edits[0].content.assets[0].video.url, 'https://example.com/clip-fb.mp4');
  assert.match(edits[0].content.text, /#FacebookReels/);
  assert.equal(remote[0].text, edits[0].content.text);
  assert.ok(saves > 0);
  assert.equal(await refreshScheduledDescriptions(opts), 0);
  assert.equal(edits.length, 1);
});

test('YouTube already queued Shorts receive English hook titles without reuploading', async () => {
  const post = { id:'short-youtube',file:'short-youtube.mp4',title:'Old source title',text:'Old text',platforms:['youtube'] };
  const env = { R2_PUBLIC_BASE_URL:'https://example.com',BUFFER_YOUTUBE_CHANNEL_ID:'yt' };
  const remote=[{id:'queued-yt',channelId:'yt',status:'scheduled',dueAt:now.toISOString(),text:'Old text'}];
  const state={deliveries:{[deliveryKey(post.id,'youtube')]:{status:'queued',bufferId:'queued-yt'}}};
  const edited=[];let saves=0;
  const opts={posts:[post],state,remote,channels:[{id:'yt',service:'youtube'}],env,
    persist:async()=>{saves++},edit:async(id,dueAt,content)=>{edited.push({id,dueAt,content});return {id,status:'scheduled',dueAt}}};
  assert.equal(await refreshScheduledDescriptions(opts),1);
  assert.equal(edited.length,1);
  assert.match(edited[0].content.metadata.youtube.title,/#Shorts #(Viral|Trending)$/);
  assert.match(edited[0].content.text,/#YouTubeShorts/);
  assert.equal(edited[0].content.assets[0].video.url,'https://example.com/short-youtube.mp4');
  assert.equal(state.deliveries[deliveryKey(post.id,'youtube')].youtubeTitleUpdatedTo, edited[0].content.metadata.youtube.title);
  assert.ok(saves>=1);
  assert.equal(await refreshScheduledDescriptions(opts),0);
});

test('Facebook: skip narrow/wide aspect ratio Reels and fill to 8 without re-queueing existing posts', async () => {
  const posts = Array.from({ length: 18 }, (_, i) => ({ id: 'ratio-' + i, file: i + '.mp4', platforms: ['facebook'] }));
  const fourExisting = Array.from({ length: 4 }, (_, i) => ({
    id: 'already-' + i, channelId: 'fb', status: 'scheduled',
    dueAt: platformQueueTargets(now, 'facebook', 8)[i].dueAt,
    assets: [{ source: 'https://example.com/' + i + '.mp4' }]
  }));
  const state = { version: 1, slots: {}, deliveries: {} };
  for (let i = 0; i < 4; i++) {
    state.deliveries[deliveryKey(posts[i].id, 'facebook')] = {
      status: 'queued', bufferId: fourExisting[i].id, channelId: 'fb'
    };
  }
  // Previously rejected aspect ratios should be skipped permanently.
  state.deliveries[deliveryKey('ratio-4', 'facebook')] = {
    status: 'rejected', error: 'Invalid post: Video aspect ratio is too narrow for Facebook Reels.'
  };
  const sent = [], remote = [...fourExisting], saved = [];
  const opts = { posts, state, remote, now, channels: [{ id:'fb', service:'facebook' }],
    env: { BUFFER_FACEBOOK_CHANNEL_ID:'fb', R2_PUBLIC_BASE_URL:'https://example.com' },
    persist: async s => saved.push(structuredClone(s)), log: () => {},
    send: async input => {
      sent.push(input);
      const file = input.assets[0].video.url.split('/').pop();
      const error = file === '5.mp4'
        ? 'Invalid post: Video aspect ratio is too narrow for Facebook Reels.'
        : file === '6.mp4'
        ? 'Invalid post: Video aspect ratio is too wide for Facebook Reels.'
        : null;
      return error ? { status:'rejected', error } : { status:'queued', bufferId:'new-'+sent.length };
    }
  };
  const result = await fillQueues(opts);
  assert.equal(result[0].queued, 8);
  assert.equal(result[0].added, 4);
  assert.equal(result[0].rejected, 2);
  assert.equal(result[0].errors.length, 0);
  assert.equal(sent.length, 6);
  assert.deepEqual(sent.map(p => p.assets[0].video.url.split('/').pop()),
    ['5.mp4','6.mp4','7.mp4','8.mp4','9.mp4','10.mp4']);
  assert.equal(remote.length, 8);
  assert.equal(new Set(remote.map(p => p.dueAt)).size, 8);
  assert.equal(state.deliveries[deliveryKey('ratio-5', 'facebook')].status, 'rejected');
  assert.equal(state.deliveries[deliveryKey('ratio-6', 'facebook')].status, 'rejected');
  assert.ok(saved.length >= 12);
  const second = await fillQueues(opts);
  assert.equal(second[0].queued, 8);
  assert.equal(second[0].added, 0);
  assert.equal(sent.length, 6);
});

test('Facebook format errors are skippable but unrelated Buffer refusals still stop the queue', async () => {
  const posts = Array.from({ length: 15 }, (_, i) => ({id:'r'+i, file:i+'.mp4', platforms:['facebook']}));
  const opts = { posts, state:{version:1,slots:{},deliveries:{}}, remote:[],
    channels:[{id:'fb',service:'facebook'}], now,
    env:{BUFFER_FACEBOOK_CHANNEL_ID:'fb',R2_PUBLIC_BASE_URL:'https://example.com'},
    persist:async()=>{},log:()=>{},
    send:async()=>({status:'rejected',error:'Permission denied: page not connected'})
  };
  const summaries=await fillQueues(opts);
  assert.equal(summaries[0].attempts,1);
  assert.equal(summaries[0].rejected,1);
  assert.match(summaries[0].errors[0],/Permission denied/);
});


test('exact video slots have zero seconds and milliseconds, even when run at 19:49:32', () => {
  for (const day of ['2026-10-12T19:49:32.536Z', '2026-02-20T14:05:07.652Z']) {
    const slots = platformQueueTargets(new Date(day), 'facebook', 8);
    assert.equal(slots.length, 8);
    assert.equal(new Set(slots.map(slot => videoHourKey(slot.dueAt))).size, 8);
    assert.ok(slots.every(slot => new Date(slot.dueAt).getUTCSeconds() === 0 &&
      new Date(slot.dueAt).getUTCMilliseconds() === 0));
  }
});

test('legacy video bursts at 00/06/12/18 with second offsets become four videos per day', async () => {
  const baseNow = new Date('2026-10-12T19:49:32.536Z');
  const targets = platformQueueTargets(baseNow, 'facebook', 8);
  const posts = Array.from({ length: 8 }, (_, i) => ({
    id: 'old-' + i, file: 'old-' + i + '.mp4', platforms: ['facebook']
  }));
  const remote = posts.map((post, i) => ({
    id: 'buffer-' + i, channelId: 'fb', status: 'scheduled',
    dueAt: new Date(Date.parse(targets[Math.floor(i / 2)].dueAt) +
      (i % 2 ? 33493 : 7652)).toISOString(),
    assets: [{source: 'https://example.com/old-' + i + '.mp4'}]
  }));
  const saved = [], edited = [];
  const state = { version: 1, slots: {}, deliveries: Object.fromEntries(posts.map((p, i) =>
    [deliveryKey(p.id, 'facebook'), { status: 'queued', bufferId: 'buffer-' + i }])) };
  const options = {
    posts, state, remote, now: baseNow, channels: [{id:'fb', service:'facebook'}],
    env: {BUFFER_FACEBOOK_CHANNEL_ID:'fb', R2_PUBLIC_BASE_URL:'https://example.com'},
    persist: async s => saved.push(structuredClone(s)),
    edit: async (id, dueAt) => { edited.push({id,dueAt}); return {id,status:'scheduled',dueAt}; }
  };
  await migrateOldSlots(options);
  assert.equal(edited.length, 8);
  assert.deepEqual(remote.map(post=>post.dueAt).sort(),targets.map(t=>t.dueAt).sort());
  assert.equal(new Set(remote.map(post=>videoHourKey(post.dueAt))).size, 8);
  assert.ok(remote.every(post=>new Date(post.dueAt).getUTCSeconds()===0));
  await migrateOldSlots(options);
  assert.equal(edited.length, 8);
  assert.ok(saved.length >= 16);
});

test('seconds-shifted external video occupies its whole hour; images do not consume Reel slots', async () => {
  const s = setup();
  const first = platformQueueTargets(now, 'tiktok', 8)[0].dueAt;
  const shifted = new Date(Date.parse(first)+33000).toISOString();
  s.options.remote.push({id:'old-external',channelId:'tiktok',status:'scheduled',
    dueAt:shifted,assets:[{source:'https://example.com/other.mp4'}]});
  s.options.remote.push({id:'photo',channelId:'tiktok',status:'scheduled',
    dueAt:platformQueueTargets(now,'tiktok',8)[1].dueAt,
    assets:[{source:'https://example.com/quiz.png'}]});
  const result = await fillQueues(s.options);
  assert.equal(result[0].added,7);
  const videoTimes = s.sent.filter(x=>x.channelId==='tiktok').map(x=>videoHourKey(x.dueAt));
  assert.ok(!videoTimes.includes(videoHourKey(first)));
  assert.ok(videoTimes.includes(videoHourKey(platformQueueTargets(now,'tiktok',8)[1].dueAt)));
  assert.equal(new Set(videoTimes).size,7);
});

test('les plateformes ont des horaires variés mais ne reprogramment pas leurs créneaux existants', async () => {
  const s = setup();
  const targets = platformQueueTargets(now, 'instagram', 8);
  assert.notDeepEqual(targets.map(x => x.dueAt), platformQueueTargets(now, 'youtube', 8).map(x => x.dueAt));
  const remote = targets.map((t,i) => ({ id:'keep-'+i, channelId:'instagram', status:'scheduled', dueAt:t.dueAt }));
  remote.forEach((p,i) => s.state.deliveries[deliveryKey(String(i),'instagram')] = {status:'queued',bufferId:p.id});
  let edits=0;
  await migrateOldSlots({state:s.state,remote,channels,now,posts:s.posts,env:s.env,persist:s.options.persist,edit:async()=>{edits++;throw Error('already valid');}});
  assert.equal(edits,0);
  assert.deepEqual(remote.map(x=>x.dueAt),targets.map(x=>x.dueAt));
});

test('arrête toute la synchronisation au premier refus de lecture vidéo Buffer', async () => {
  const s = setup();
  s.options.send = async input => {
    s.sent.push(input);
    return { status: 'rejected', error: 'Invalid post: Video could not be read from its URL.' };
  };
  await assert.rejects(fillQueues(s.options), /Arrêt immédiat après un seul refus/);
  assert.equal(s.sent.length, 1);
  assert.equal(s.state.deliveries[deliveryKey('0', 'tiktok')].status, 'rejected');
});

test('invalide le catalogue journalier si Buffer ne peut pas lire une source R2', async () => {
  const s = setup();
  s.state.catalog = { day: '2026-10-24', posts: structuredClone(s.posts) };
  s.options.send = async input => {
    s.sent.push(input);
    return { status: 'rejected', error: 'Invalid post: Video could not be read from its URL.' };
  };
  await assert.rejects(fillQueues(s.options), /catalogue R2 invalidé/);
  assert.equal(s.sent.length, 1);
  assert.equal(s.state.catalog, undefined);
  assert.ok(s.saved.some(saved => saved.catalog === undefined));
});

test('ne retente jamais une livraison dont le résultat Buffer est incertain', async () => {
  const s = setup();
  s.state.deliveries[deliveryKey('0', 'tiktok')] = { status: 'uncertain', error: 'Vérifier Buffer' };
  await assert.rejects(fillQueues(s.options), /incertain ou en cours/);
  assert.equal(s.sent.length, 0);
  assert.equal(s.saved.length, 0);
});
