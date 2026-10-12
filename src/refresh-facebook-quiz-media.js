import { readFile, writeFile, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { graphql } from './buffer.js';
import { resolveQueueChannels } from './discovery.js';

const file = 'pop-culture/media-refresh-state.json';
const base = 'https://raw.githubusercontent.com/mouadchag358/buffer-shorts/';
const positive = /^quiz-\d{3}$/;
const imageSource = /\.(?:png|jpe?g|webp)(?:[?#]|$)/i;
const trim = text => typeof text === 'string' ? text.trim() : '';

export function buildMediaEdit(post, card, commitSha) {
  if (!/^[a-f0-9]{40}$/.test(commitSha) || !positive.test(card?.id) || !/^pop-culture\/cards\/quiz-\d{3}\.png$/.test(card.image)) {
    throw new Error('Invalid immutable image reference');
  }
  return {
    id: post.id,
    assets: [{ image: { url: `${base}${commitSha}/${card.image}` } }],
    metadata: { facebook: { type: 'post' } }
    // No dueAt, mode or schedulingType: keep Buffer's original publication slot.
    // No text field: keep the original caption and hashtags unchanged.
  };
}
export function findScheduledQuizImages(remote, cards, approvedIds, channelId, knownImages = {}) {
  const approved = new Set(approvedIds);
  const indexed = new Map(cards.filter(c => approved.has(c.id)).map(c => [trim(c.caption), c]));
  if (indexed.size !== approved.size) throw new Error('Some approved quiz cards are missing or captions are duplicated');
  const selected = [], unsafe = [];
  for (const post of remote) {
    if (post.channelId !== channelId || post.status !== 'scheduled' || !post.dueAt) continue;
    const card = indexed.get(trim(post.text));
    if (!card) continue;
    const assets = post.assets || [];
    const knownImage = knownImages[post.id] === card.image;
    const hasVideo = assets.some(a => /\\.(?:mp4|mov|webm)(?:[?#]|$)/i.test(a.source || ''));
    const hasImage = assets.length === 1 && (knownImage || assets.some(a => imageSource.test(a.source || '')));
    if (hasVideo || !hasImage) {
      unsafe.push({ id: post.id, quizId: card.id, reason: hasVideo ? 'video media' : 'unknown or non-image media' });
      continue;
    }
    selected.push({ post, card });
  }
  selected.sort((a,b) => Date.parse(a.post.dueAt) - Date.parse(b.post.dueAt));
  return { selected, unsafe };
}
function blobRevision(image) {
  return execFileSync('git', ['rev-parse', `HEAD:${image}`], { encoding: 'utf8' }).trim();
}
function commitRevision() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}
async function checkpoint(state) {
  await writeFile(file+'.tmp', JSON.stringify(state, null, 2)+'\n');
  await rename(file+'.tmp', file);
  if (process.env.PERSIST_GIT === 'true') {
    execFileSync('git', ['add', file], {stdio:'inherit'});
    try { execFileSync('git', ['diff', '--cached', '--quiet']); return; }
    catch (e) { if (e.status !== 1) throw e; }
    execFileSync('git', ['commit', '-m', 'Checkpoint Facebook quiz image refresh [skip ci]'], {stdio:'inherit'});
    // A failed push must stop the action; do NOT issue another editPost automatically.
    execFileSync('git', ['push', 'origin', 'HEAD'], {stdio:'inherit'});
  }
}
async function facebookQueue(orgId, channelId, env) {
  const data = await graphql(`query FacebookQuizImageQueue($input: PostsInput!) {
    posts(first:100, input:$input) {
      edges { node {id channelId status dueAt text assets {source}} }
      pageInfo {hasNextPage}
    }
  }`,{input:{organizationId:orgId,filter:{channelIds:[channelId],status:['scheduled']},sort:[{field:'dueAt',direction:'asc'}]}},env);
  if (data.posts?.pageInfo?.hasNextPage) throw Error('More than 100 scheduled Facebook posts; stop before modifying a partial list');
  if (!Array.isArray(data.posts?.edges)) throw Error('Facebook queue unreadable');
  return data.posts.edges.map(e=>e.node);
}
async function verifyPublicImage(url) {
  const check = await fetch(url, {method:'HEAD',signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!check.ok || !(check.headers.get('content-type')||'').startsWith('image/'))
    throw Error('Image is not publicly accessible: '+url);
}
export async function refreshScheduledFacebookQuizImages({dryRun=false,log=console.log}={}) {
  const cards=JSON.parse(await readFile('pop-culture/questions.json','utf8'));
  const manifest=JSON.parse(await readFile('pop-culture/redesigned.json','utf8'));
  const state=JSON.parse(await readFile(file,'utf8'));
  if (!Array.isArray(manifest) || !manifest.length || manifest.some(x=>!positive.test(x)) || new Set(manifest).size!==manifest.length)
    throw Error('Invalid redesigned image manifest');
  const {env,channels} = await resolveQueueChannels(['facebook']);
  const channel=channels[0];
  if(channel.isDisconnected || channel.isLocked || channel.isQueuePaused) throw Error('Facebook channel unavailable');
  const remote = await facebookQueue(env.BUFFER_ORGANIZATION_ID, channel.id, env);
  const queueState=JSON.parse(await readFile('pop-culture/state.json','utf8'));
  const knownImages={};
  for(const [id,entry] of Object.entries(queueState.replacements || {})) {
    if(entry.status==='completed' && entry.image) knownImages[id]=entry.image;
  }
  for(const [quizId,entry] of Object.entries(queueState.newImages || {})) {
    if(entry.status==='queued' && entry.bufferId) knownImages[entry.bufferId]='pop-culture/cards/'+quizId+'.png';
  }
  const {selected,unsafe} = findScheduledQuizImages(remote,cards,manifest,channel.id,knownImages);
  log(`Facebook: ${remote.length} scheduled posts, ${selected.length} approved image quizzes, ${unsafe.length} skipped unsafe candidates`);
  for(const skipped of unsafe) log('Skipped '+JSON.stringify(skipped));
  if(unsafe.length) throw Error('Some quiz posts are not identifiable as images; stop to avoid editing videos');
  if(selected.length > 20) throw Error('Too many quiz image matches; stop before unintended mass updates');
  const seenCards=new Set();
  for(const {post,card} of selected) {
    if(seenCards.has(card.id)) throw Error('Duplicate scheduled quiz caption: '+card.id);
    seenCards.add(card.id);
    const rev=blobRevision(card.image);
    const entry=state[post.id];
    if(entry?.status==='editing'||entry?.status==='uncertain') throw Error('Uncertain prior media change for post '+post.id+'; reconcile in Buffer first');
    if(entry?.status==='completed'&&entry.imageBlobSha===rev) {log('Already up to date: '+card.id);continue;}
    if(Date.parse(post.dueAt)<Date.now()+20*60000) {log('Skipping imminent post: '+card.id);continue;}
    const input=buildMediaEdit(post,card,commitRevision());
    if (dryRun) {log(`DRY RUN ${card.id} -> ${post.id} at ${post.dueAt}: ${input.assets[0].image.url}`);continue;}
    await verifyPublicImage(input.assets[0].image.url);
    state[post.id]={status:'editing',quizId:card.id,imageBlobSha:rev,originalDueAt:post.dueAt,updatedAt:new Date().toISOString()};
    await checkpoint(state);
    let result;
    try {
      const data=await graphql(`mutation RefreshQuizMedia($input:EditPostInput!){
        editPost(input:$input){
          ... on PostActionSuccess {post{id status dueAt}}
          ... on MutationError {message}
        }
      }`,{input},env);
      result=data.editPost;
    } catch(e) {
      throw Error('Uncertain Buffer media edit for '+card.id+': '+e.message+'; do not retry without verifying');
    }
    const edited=result?.post;
    if(!edited?.id || edited.id!==post.id || edited.status!=='scheduled' ||
       Date.parse(edited.dueAt)!==Date.parse(post.dueAt)) {
      if(result?.message) {
        state[post.id]={...state[post.id],status:'rejected',error:result.message};
        await checkpoint(state);
      }
      throw Error('Buffer did not confirm quiz media edit for '+card.id+': '+(result?.message||'unknown response'));
    }
    state[post.id]={...state[post.id],status:'completed',url:input.assets[0].image.url,updatedAt:new Date().toISOString()};
    await checkpoint(state);
    log(`Updated ${card.id}: post ${post.id}; schedule preserved ${post.dueAt}`);
  }
  log('Facebook quiz image refresh finished');
}
if (process.argv[1]?.replaceAll('\\','/').endsWith('/refresh-facebook-quiz-media.js')) {
  refreshScheduledFacebookQuizImages({dryRun:process.argv.includes('--dry-run')}).catch(e=>{console.error(e.message);process.exitCode=1});
}
