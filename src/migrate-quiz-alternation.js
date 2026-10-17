import {readFile,writeFile,rename} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {queuedPosts,graphql} from './buffer.js';
import {resolveQueueChannels} from './discovery.js';
import {alternatingCards} from './quiz-alternation.js';
import {buildMediaEdit} from './refresh-facebook-quiz-media.js';
const file='pop-culture/state.json';
const dryRun=process.argv.includes('--dry-run');
async function save(s) {
 await writeFile(file+'.tmp',JSON.stringify(s,null,2)+'\n');await rename(file+'.tmp',file);
 if(process.env.PERSIST_GIT==='true'){
  execFileSync('git',['add',file]);
  try{execFileSync('git',['diff','--cached','--quiet']);return;}catch(e){if(e.status!==1)throw e;}
  execFileSync('git',['commit','-m','Checkpoint alternating quiz formats [skip ci]'],{stdio:'inherit'});
  execFileSync('git',['push','origin','HEAD'],{stdio:'inherit'});
 }
}
async function main(){
 const state=JSON.parse(await readFile(file,'utf8'));
 if(state.alternation?.completed){console.log('Existing queue migration already completed');return;}
 const cards=JSON.parse(await readFile('pop-culture/questions.json','utf8'));
 const {env,channels}=await resolveQueueChannels(['facebook']);const channel=channels[0];
 if(channel.isDisconnected||channel.isLocked||channel.isQueuePaused)throw Error('Facebook channel unavailable');
 const remote=await queuedPosts(env.BUFFER_ORGANIZATION_ID,[channel.id],env);
 // Reconcile a prior interrupted creation against the authoritative Buffer queue.
 for(const [id,v] of Object.entries(state.newImages||{})){
  if(!['sending','uncertain'].includes(v.status))continue;
  const card=cards.find(c=>c.id===id);
  const found=remote.filter(p=>p.channelId===channel.id&&p.text?.trim()===card?.caption.trim()&&Date.parse(p.dueAt)===Date.parse(v.dueAt));
  if(found.length>1)throw Error('Multiple matches for interrupted quiz delivery '+id);
  if(found.length===0){
   // Preserve the unresolved delivery and exclude it permanently from automatic retries.
   // It is absent from the complete scheduled/sending queue; never create it again.
   Object.assign(v,{priorStatus:v.status,status:'held',holdReason:'Legacy delivery unconfirmed; excluded from automatic retry',heldAt:new Date().toISOString()});
   console.log('Held legacy uncertain delivery without retry',id);continue;
  }
  Object.assign(v,{status:'queued',bufferId:found[0].id,bufferStatus:found[0].status});
 }
 if(!state.alternation){
  const targets=Object.entries(state.newImages||{}).map(([id,v])=>({oldId:id,...v,post:remote.find(p=>p.id===v.bufferId)}))
   .filter(v=>v.post?.status==='scheduled'&&Date.parse(v.post.dueAt)>Date.now()+5*60000)
   .sort((a,b)=>Date.parse(a.post.dueAt)-Date.parse(b.post.dueAt));
  if(!targets.length)throw Error('No upcoming known Facebook quiz slots');
  if(targets.length>20)throw Error('Unexpectedly large queue');
  const history=structuredClone(state);for(const t of targets)delete history.newImages[t.oldId];
  const chosen=alternatingCards(history,cards,targets.length);
  if(dryRun){console.log('Would alternate existing slots',targets.map((t,i)=>({postId:t.post.id,dueAt:t.post.dueAt,cardId:chosen[i].id})));return;}
  state.alternation={version:1,completed:false,startedAt:new Date().toISOString(),originalEntries:targets.map(({post,...v})=>v),edits:targets.map((t,i)=>({postId:t.post.id,dueAt:t.post.dueAt,cardId:chosen[i].id,status:'pending'}))};
  // Archive pending assignments before replacing them, preserving already published history.
  state.newImages=history.newImages;delete state.imageBatch;await save(state);
 }
 if(dryRun){console.log('Would resume alternation migration');return;}
 const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 for(const e of state.alternation.edits){
  const card=cards.find(c=>c.id===e.cardId);const post=remote.find(p=>p.id===e.postId);
  if(e.status==='completed')continue;
  if(!post||post.status!=='scheduled'||Date.parse(post.dueAt)!==Date.parse(e.dueAt))throw Error('Original quiz slot changed '+e.postId);
  if(e.status==='editing'){
   if(post.text?.trim()!==card.caption.trim()||!post.assets?.some(a=>a.source?.endsWith('/'+card.image)))throw Error('Uncertain prior edit '+e.postId);
  }else{
   const input=buildMediaEdit(post,card,sha);
   const head=await fetch(input.assets[0].image.url,{method:'HEAD',signal:AbortSignal.timeout(15000)});
   if(!head.ok||!head.headers.get('content-type')?.startsWith('image/'))throw Error('Missing public quiz image '+card.image);
   e.status='editing';await save(state);
   const data=await graphql(`mutation AlternateQuiz($input:EditPostInput!){editPost(input:$input){... on PostActionSuccess{post{id status dueAt}} ... on MutationError{message}}}`,{input},env);
   const p=data.editPost?.post;
   if(p?.id!==e.postId||p.status!=='scheduled'||Date.parse(p.dueAt)!==Date.parse(e.dueAt))throw Error('Quiz edit not confirmed '+e.postId+': '+(data.editPost?.message||'unknown'));
  }
  state.newImages[card.id]={status:'queued',bufferId:e.postId,bufferStatus:'scheduled',dueAt:e.dueAt};e.status='completed';await save(state);
  console.log('Reaction slot verified',card.id,card.answerFormat,e.dueAt);
 }
 state.alternation.completed=true;await save(state);console.log('Reaction-only migration completed');
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
