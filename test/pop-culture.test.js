import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { imageSlots, imageInput } from '../src/pop-culture-images.js';
const posts = JSON.parse(await readFile(new URL('../pop-culture/questions.json', import.meta.url)));
test('100 original English cards with unique IDs and valid image names', () => {
  assert.equal(posts.length, 100);
  assert.equal(new Set(posts.map(p => p.id)).size, 100);
  assert.equal(posts.filter(p => p.kind === 'quiz').length, 40);
  assert.equal(posts.filter(p => p.kind === 'duel').length, 60);
  for (const p of posts) {
    assert.match(p.image, /^pop-culture\/cards\/(quiz|duel)-\d{3}\.png$/);
    assert.ok(p.question.length && p.options.length >= 2);
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
 assert.deepEqual(input.assets, [{image:{url:'https://raw.githubusercontent.com/mouadchag358/buffer-shorts/main/pop-culture/cards/quiz-001.png'}}]);
 assert.equal(input.mode,'customScheduled');
 assert.deepEqual(input.metadata,{facebook:{type:'post'}});
 assert.ok(input.text.includes('QUIZ TIME!'));
});
