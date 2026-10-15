# Facebook pop culture quizzes

200 illustrated cards: the 100 original A/B/C/D quizzes plus 100 reaction versions (quiz-101 through quiz-200).
The artwork, questions and answer wording are preserved. Reaction mapping: A = 👍, B = ❤️, C = 😂, D = 😮.

The existing Facebook quiz slots alternate reaction and letter formats. Previously published history is retained; upcoming known quiz slots are updated in place with unchanged publication times. Each subsequent batch of eight continues the alternation. After one finite format inventory runs out, the scheduler finishes the remaining cards.

- Catalog and captions: `questions.json`.
- Native renderer: `scripts/render_approved_quizzes.py --reactions-only`; leaves all original JPGs unchanged.
- One-time live queue migration: `src/migrate-quiz-alternation.js`, checkpointed before each edit.
- Scheduler: `src/pop-culture-images.js`, eight new cards every twelve hours on the existing 00/06/12/18 local slot grid.
- Public media: `cards/quiz-NNN.jpg` on this repository; migrations pin immutable commit URLs.
- Verification: `npm test`.

Buffer credentials remain in GitHub Actions secrets. Reels and other social channels are outside this change.
