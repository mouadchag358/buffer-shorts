import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { imageSlots, imageInput, planImageBatch } from '../src/pop-culture-images.js';
const catalog = JSON.parse(await readFile(new URL('../pop-culture/questions.json', import.meta.url)));
const posts = catalog.filter(p=>p.answerFormat === 'reactions');
test('200 English cards with unique IDs and valid image names', () => {
  assert.equal(catalog.length, 200);
  assert.equal(new Set(catalog.map(p => p.id)).size, 200);
  assert.equal(catalog.filter(p => p.kind === 'quiz').length, 200);
  assert.equal(catalog.filter(p => p.kind === 'duel').length, 0);
  for (const p of catalog) {
    assert.match(p.image, /^pop-culture\/cards\/(quiz-\d{3}\.(?:png|jpe?g)|duel-\d{3}\.png)$/);
    assert.ok(p.question.length && p.options.length === 4);
    assert.ok(p.caption.includes('#PopCulture'));
  }
});
test('two picture posts per day, no collision with existing reels', () => {
 const slots=imageSlots(new Date('2026-10-12T19:00:00Z'), 6);
 assert.equal(slots.length,6);
 assert.ok(slots.every(s=>['00','06','12','18'].includes(s.localHour)));
 assert.ok(slots.every(s=>['00','06','12','18'].includes(s.localHour)));
 assert.equal(new Set(slots.map(s=>s.dueAt)).size,6);
});
test('Buffer image payload is separate from Facebook Reel metadata', () => {
 const input=imageInput(posts[0], 'fb', '2026-10-13T08:00:00Z');
 assert.deepEqual(input.assets, [{image:{url:'https://raw.githubusercontent.com/mouadchag358/buffer-shorts/main/pop-culture/cards/quiz-101.jpg'}}]);
 assert.equal(input.mode,'customScheduled');
 assert.deepEqual(input.metadata,{facebook:{type:'post'}});
 assert.ok(input.text.includes('QUIZ TIME!'));
});

test('12-hour batches continue after quiz 004, are idempotent and resume partial batches',()=>{
 const state={newImages:Object.fromEntries(posts.slice(0,4).map(p=>[p.id,{status:'queued'}]))};
 const now=new Date('2026-10-13T18:00:00Z');
 const batch=planImageBatch(state,posts,now);
 assert.deepEqual(batch.cardIds,posts.slice(4,12).map(p=>p.id));
 state.imageBatch=batch;
 state.newImages['quiz-105']={status:'queued'};
 assert.deepEqual(planImageBatch(state,posts,new Date('2026-10-14T01:00:00Z')),batch);
 for(const id of batch.cardIds)state.newImages[id]={status:'queued'};
 batch.completed=true;
 assert.equal(planImageBatch(state,posts,now),batch);
 assert.deepEqual(planImageBatch(state,posts,new Date('2026-10-14T01:00:00Z')).cardIds,posts.slice(12,20).map(p=>p.id));
});
test('image schedule can hold all 100 cards without exhausting the old nine-day horizon',()=>{
 const slots=imageSlots(new Date('2026-10-13T18:00:00Z'),128);
 assert.equal(slots.length,128);
 assert.equal(new Set(slots.map(s=>s.dueAt)).size,128);
});
