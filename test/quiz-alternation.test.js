import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { alternatingCards } from '../src/quiz-alternation.js';

const cards = JSON.parse(await readFile('pop-culture/questions.json', 'utf8'));

// Archived image data remains readable, but quizzes are no longer published.
test('archived reaction quizzes preserve their original questions and answers', () => {
  const old = cards.filter(c => c.answerFormat === 'letters');
  const added = cards.filter(c => c.answerFormat === 'reactions');
  assert.equal(old.length, 100);
  assert.equal(added.length, 100);
  for (const c of added) {
    const source = old.find(x => x.id === c.sourceQuizId);
    assert.ok(source);
    assert.equal(c.question, source.question);
    assert.deepEqual(c.options, source.options);
    assert.equal(c.answer, source.answer);
  }
});

test('archived reaction-only selection does not duplicate cards', () => {
  const state = { newImages: {} };
  const first = alternatingCards(state, cards, 8);
  assert.equal(first.length, 8);
  assert.ok(first.every(c => c.answerFormat === 'reactions'));
  for (const c of first) state.newImages[c.id] = { status: 'queued' };
  const next = alternatingCards(state, cards, 8);
  assert.equal(next.length, 8);
  assert.ok(next.every(c => c.answerFormat === 'reactions'));
  assert.ok(next.every(c => !first.some(f => f.id === c.id)));
});
