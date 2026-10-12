import { readFile, writeFile, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { queuedPosts, graphql, createPost } from './buffer.js';
import { resolveQueueChannels } from './discovery.js';
import { localParts, videoHourKey } from './queue-schedule.js';

const statePath='pop-culture/state.json';
const prefix='https://raw.githubusercontent.com/mouadchag358/buffer-shorts/main/';
const isVideo = p => p.assets?.some(a=>/\\.(mp4|mov|webm)(?:[?#]|$)/i.test(a.source||''));
export function imageInput(post,channelId,dueAt){
  return {channelId,text:post.caption,schedulingType:'automatic',mode:'customScheduled',
    dueAt,needsApproval:false,metadata:{facebook:{type:'post'}},assets:[{image:{url:prefix+post.image}}]};
}
export function imageSlots(now=new Date(), count=8){
  const p=localParts(now),today=p.year+'-'+p.month+'-'+p.day;
  const out=[]; const start=Math.ceil((now.getTime()+600000)/60000)*60000;
  for(let i=0;i<9*1440&&out.length<count;i++){
    const d=new Date(start+i*60000),x=localParts(d);
    if((x.year+'-'+x.month+'-'+x.day)===today||x.minute!=='00'||!['00','06','12','18'].includes(x.hour)) continue;
    out.push({key:x.year+'-'+x.month+'-'+x.day+'-'+x.hour,dueAt:d.toISOString(),localHour:x.hour});
  }
  return out;
}
async function persist(state) {
  await writeFile(statePath+'.tmp',JSON.stringify(state,null,2)+String.fromCharCode(10));
  await rename(statePath+'.tmp',statePath);
  if(process.env.PERSIST_GIT==='true'){
    execFileSync('git',['add',statePath],{stdio:'inherit'});
    try {execFileSync('git',['diff','--cached','--quiet']);return;}
    catch(e){if(e.status!==1)throw e;}
    execFileSync('git',['commit','-m','Record Facebook image replacement [skip ci]'],{stdio:'inherit'});
    execFileSync('git',['push','origin','HEAD'],{stdio:'inherit'});
  }
}
async function replenishFacebookPhotos({channel,env,remote,state,cards,dryRun,log}) {
  state.newImages??={};
  if(Object.values(state.newImages).some(v=>['sending','uncertain'].includes(v.status)))
    throw Error('Uncertain previous Facebook image delivery: inspect Buffer before scheduling anything else');
  const scheduled=remote.filter(p=>p.channelId===channel.id&&p.status==='scheduled'&&p.dueAt);
  const occupied=new Set(scheduled.map(p=>videoHourKey(p.dueAt)));
  let added=0;
  for (const slot of imageSlots(new Date(),32)) {
    if(scheduled.length+added>=8) break;
    const key=videoHourKey(slot.dueAt);
    if(occupied.has(key)) continue;
    const card=cards[8+Object.keys(state.newImages).length];
    if(!card) {log('All 100 pop culture images have been used');break;}
    const input=imageInput(card,channel.id,slot.dueAt);
    if(dryRun){log('Would queue '+card.id+' at '+slot.dueAt);added++;occupied.add(key);continue;}
    const check=await fetch(input.assets[0].image.url,{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!check.ok||!(check.headers.get('content-type')||'').startsWith('image/'))throw Error('Image unavailable: '+card.image);
    state.newImages[card.id]={status:'sending',dueAt:slot.dueAt};
    await persist(state);
    let result;
    try {result=await createPost(input,env);}
    catch(e){state.newImages[card.id]={...state.newImages[card.id],status:'uncertain',error:e.message};await persist(state);throw Error('Uncertain Buffer image creation; do not retry: '+card.id);}
    state.newImages[card.id]={...state.newImages[card.id],...result};
    await persist(state);
    if(result.status!=='queued')throw Error('Buffer rejected image '+card.id+': '+result.error);
    occupied.add(key);added++;
    log('Queued new image '+card.id+' at '+slot.dueAt);
    if(added>=4)break;
  }
  log('New scheduled Facebook images: '+added);
}
export async function syncImages({dryRun=false,log=console.log}={}){
  const cards=JSON.parse(await readFile('pop-culture/questions.json','utf8'));
  const state=JSON.parse(await readFile(statePath,'utf8'));
  state.replacements??={};
  if(cards.length!==100)throw Error('Expected 100 cards');
  const {env,channels}=await resolveQueueChannels(['facebook']);
  const channel=channels[0];
  if(channel.isQueuePaused||channel.isLocked||channel.isDisconnected)throw Error('Facebook channel unavailable');
  const remote=await queuedPosts(env.BUFFER_ORGANIZATION_ID,[channel.id],env);
  const scheduled=remote.filter(p=>p.channelId===channel.id&&p.status==='scheduled'&&p.dueAt)
    .sort((a,b)=>Date.parse(a.dueAt)-Date.parse(b.dueAt)||a.id.localeCompare(b.id));
  if(Object.values(state.replacements).filter(v=>v.status==='completed').length===8) {
    log('Automatic new Facebook images paused pending status reconciliation of existing scheduled quiz posts');return;
  }
  const targets=scheduled.slice(0,8);
  if(targets.length!==8 || scheduled.length!==8) { log(JSON.stringify({facebookQueue:remote.length,scheduled:scheduled.length,selected:targets.length,media:scheduled.slice(0,12).map(p=>({id:p.id,status:p.status,dueAt:p.dueAt,assets:(p.assets||[]).map(a=>({hasSource:!!a.source,extension:(a.source||'').split('?')[0].match(/\\.[a-z0-9]{2,5}$/i)?.[0]||null}))}))})); throw Error('Expected 8 scheduled Facebook posts, found '+targets.length); }
  let changed=0;
  for(let i=0;i<targets.length;i++){
    const target=targets[i],card=cards[i],url=prefix+card.image;
    if(state.replacements[target.id]?.status==='completed' && state.replacements[target.id]?.image===card.image && state.replacements[target.id]?.dueAt===target.dueAt) {log('Replacement already verified '+target.id);continue;}
    const already=target.assets?.some(a=>a.source===url);
    if(already){log('Already replaced '+target.id);continue;}
    if(!target.assets?.length)throw Error('No existing media in Facebook slot '+target.id);
    if(state.replacements[target.id]?.status==='editing'||state.replacements[target.id]?.status==='completed')
      throw Error('Previous replacement uncertain or mismatched: '+target.id);
    if(dryRun){log('Preview '+target.id+' -> '+card.image+' at '+target.dueAt);continue;}
    const check=await fetch(url,{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!check.ok||!(check.headers.get('content-type')||'').startsWith('image/'))throw Error('Image inaccessible: '+url);
    state.replacements[target.id]={status:'editing',image:card.image,dueAt:target.dueAt};
    await persist(state);
    let data;
    try {
      data=await graphql(`mutation EditPicture($input: EditPostInput!) {
        editPost(input:$input) {... on PostActionSuccess {post {id status dueAt}}
          ... on MutationError {message}}
      }`,{input:{id:target.id,text:card.caption,assets:[{image:{url}}],metadata:{facebook:{type:'post'}}}},env);
    } catch(e) {throw Error('Edit result uncertain for '+target.id+': '+e.message);}
    const p=data.editPost?.post;
    if(p?.id!==target.id||p.status!=='scheduled'||Date.parse(p.dueAt)!==Date.parse(target.dueAt))
      throw Error('Buffer edit not confirmed for '+target.id+': '+(data.editPost?.message||p?.status||'unknown'));
    state.replacements[target.id]={status:'completed',image:card.image,dueAt:target.dueAt};
    await persist(state);changed++;
    log('Replaced '+target.id+' -> '+card.image+' at '+target.dueAt);
  }
  log('Completed replacements in this run: '+changed);
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/pop-culture-images.js'))
 syncImages({dryRun:process.argv.includes('--dry-run')}).catch(e=>{console.error(e.message);process.exitCode=1;});
