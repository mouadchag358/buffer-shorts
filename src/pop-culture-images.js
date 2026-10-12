import { readFile, writeFile, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveQueueChannels } from './discovery.js';
import { queuedPosts, createPost } from './buffer.js';
import { localParts } from './queue-schedule.js';

const statePath = 'pop-culture/state.json';
export function imageSlots(now = new Date(), count = 6) {
  const nowParts = localParts(now);
  const today = `${nowParts.year}-${nowParts.month}-${nowParts.day}`;
  const allowed = new Set(['09', '21']);
  const result = [], seen = new Set();
  const start = now.getTime() + 10 * 60_000;
  for (let i=0; i<5*24*60 && result.length<count; i++) {
    const date = new Date(start + i*60_000), p = localParts(date);
    const day = `${p.year}-${p.month}-${p.day}`;
    if (day===today || p.minute!=='00' || !allowed.has(p.hour)) continue;
    const key = `${day}-${p.hour}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({key, dueAt:date.toISOString(), localHour:p.hour});
  }
  if (result.length!==count) throw new Error('Not enough future Facebook image slots');
  return result;
}
export function imageInput(post, channelId, dueAt) {
  if (!/^pop-culture\/cards\/(?:quiz|duel)-\d{3}\.png$/.test(post.image)) throw new Error('Invalid image path');
  return {channelId, text:post.caption, schedulingType:'automatic', mode:'customScheduled',
    dueAt, needsApproval:false, assets:[{image:{url:`https://raw.githubusercontent.com/mouadchag358/buffer-shorts/main/${post.image}`}}]};
}
async function persist(state) {
  await writeFile(statePath+'.tmp', JSON.stringify(state,null,2)+'\n');
  await rename(statePath+'.tmp',statePath);
  if(process.env.PERSIST_GIT==='true') {
    execFileSync('git',['add',statePath],{stdio:'inherit'});
    try { execFileSync('git',['diff','--cached','--quiet']); return; }
    catch(e) { if(e.status!==1) throw e; }
    execFileSync('git',['commit','-m','Save Facebook image queue checkpoint [skip ci]'],{stdio:'inherit'});
    // Never re-send a Buffer API request after a checkpoint push failure.
    execFileSync('git',['push','origin','HEAD'],{stdio:'inherit'});
  }
}
export async function syncImages({ dryRun = false, log = console.log } = {}) {
  const posts = JSON.parse(await readFile('pop-culture/questions.json','utf8'));
  const state = JSON.parse(await readFile(statePath,'utf8'));
  if(posts.length!==100||new Set(posts.map(x=>x.id)).size!==100) throw new Error('Image catalog must contain 100 unique posts');
  if(Object.values(state.deliveries).some(d=>['sending','uncertain'].includes(d.status))) throw new Error('Uncertain image delivery: verify Buffer, do not retry automatically');
  const now=new Date(), slots=imageSlots(now);
  if(dryRun) { log(JSON.stringify({mode:'dry-run',totalImages:posts.length, slots:slots.map(s=>s.key),sent:Object.keys(state.deliveries).length})); return; }
  const {env,channels} = await resolveQueueChannels(['facebook']);
  const channel=channels[0];
  if(channel.isQueuePaused||channel.isDisconnected||channel.isLocked) throw new Error('Facebook channel unavailable or paused');
  const remote=await queuedPosts(env.BUFFER_ORGANIZATION_ID,[channel.id],env);
  const remoteSlots = new Set(remote.filter(p=>['scheduled','sending'].includes(p.status)).map(p=>p.dueAt));
  let sent=0;
  for(const slot of slots) {
    if(remoteSlots.has(slot.dueAt)) continue;
    const existing=Object.entries(state.deliveries).find(([,delivery])=>delivery.dueAt===slot.dueAt);
    if(existing) {
      // Never fill a missing scheduled post with a duplicate without reconciliation.
      if(existing[1].status==='queued') throw new Error('Previously queued image missing from Buffer schedule: '+slot.key);
      continue;
    }
    const next=posts.find(p=>!state.deliveries[p.id]);
    if(!next) {log('All 100 images have been allocated');break;}
    if(sent>=2) break; // two new API writes maximum per workflow run
    const input=imageInput(next,channel.id,slot.dueAt);
    // Buffer must retrieve the PNG directly. Do not silently send a broken image URL.
    const check=await fetch(input.assets[0].image.url,{method:'HEAD',signal:AbortSignal.timeout(15000),redirect:'error'});
    if(!check.ok || !(check.headers.get('content-type')||'').startsWith('image/')) throw new Error('Image is not publicly available: '+next.image);
    state.deliveries[next.id]={status:'sending',dueAt:slot.dueAt,channelId:channel.id,updatedAt:now.toISOString()};
    await persist(state);
    let result;
    try { result=await createPost(input,env); }
    catch {result={status:'uncertain',error:'Check Buffer before retrying'};}
    state.deliveries[next.id]={...state.deliveries[next.id],...result,updatedAt:new Date().toISOString()};
    await persist(state);
    if(result.status!=='queued') throw new Error('Buffer image post not queued: '+next.id+' / '+result.status);
    remoteSlots.add(slot.dueAt);
    log('Scheduled '+next.id+' at '+slot.dueAt);sent++;
  }
  log('Added '+sent+' image posts; videos are untouched.');
}
if(process.argv[1] && import.meta.url===new URL('file://'+fileURLToPath(import.meta.url)).href && process.argv[1].replaceAll('\\','/').endsWith('pop-culture-images.js')) {
  syncImages({dryRun:process.argv.includes('--dry-run')}).catch(e=>{console.error(e.message);process.exitCode=1;});
}
