import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';import {alternatingCards} from '../src/quiz-alternation.js';
const cards=JSON.parse(await readFile('pop-culture/questions.json','utf8'));
test('adds 100 reaction versions without changing original questions or answers',()=>{
 const old=cards.filter(c=>c.answerFormat==='letters'),added=cards.filter(c=>c.answerFormat==='reactions');
 assert.equal(old.length,100);assert.equal(added.length,100);
 for(const c of added){const source=old.find(x=>x.id===c.sourceQuizId);assert.ok(source);assert.equal(c.question,source.question);assert.deepEqual(c.options,source.options);assert.equal(c.answer,source.answer);assert.ok(c.caption.includes('React with your answer!'));assert.ok(!/\n[A-D]\)/.test(c.caption));}
});
test('alternates formats despite previously published letter quizzes and resumes across batches',()=>{
 const s={newImages:Object.fromEntries(cards.filter(c=>c.answerFormat==='letters').slice(0,11).map((c,i)=>[c.id,{status:'queued',dueAt:new Date(Date.UTC(2026,9,12,i)).toISOString()}]))};
 const first=alternatingCards(s,cards,8);assert.deepEqual(first.map(c=>c.answerFormat),['reactions','letters','reactions','letters','reactions','letters','reactions','letters']);
 assert.equal(first[0].id,'quiz-101');assert.equal(first[1].id,'quiz-012');
 for(let i=0;i<first.length;i++)s.newImages[first[i].id]={status:'queued',dueAt:new Date(Date.UTC(2026,9,15,i)).toISOString()};
 const second=alternatingCards(s,cards,8);assert.equal(second[0].id,'quiz-105');assert.equal(second[1].id,'quiz-016');
 assert.ok(second.every(c=>!first.some(f=>f.id===c.id)));
});
