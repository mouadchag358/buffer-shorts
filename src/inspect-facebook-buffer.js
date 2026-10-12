import { readFile } from 'node:fs/promises';
import { getPost } from './buffer.js';

const historical=JSON.parse(await readFile('pop-culture/state.json','utf8'));
const ids=[
 ...Object.entries(historical.replacements||{}).map(([id,q])=>({id,quiz:q.image.match(/quiz-\\d{3}/)?.[0]||'unknown',source:'original'})),
 ...Object.entries(historical.newImages||{}).filter(([,v])=>v.bufferId).map(([quiz,v])=>({id:v.bufferId,quiz,source:'new'})),
];
for (const {id,quiz,source} of ids) {
 try {
  const p=await getPost(id);
  console.log(JSON.stringify({id,quiz,source,status:p.status,dueAt:p.dueAt,sentAt:p.sentAt,externalLink:p.externalLink}));
 }catch(e) {
  console.log(JSON.stringify({id,quiz,source,readError:e.code||e.message}));
 }
}
