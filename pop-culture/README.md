# 100 English Pop Culture Images for Facebook

There are 100 **original** square 1080x1080 social cards: **40 quizzes + 60 A/B duels**, with English questions, captions, hashtags and answer keys for quizzes.

- Editable SVG designs: `pop-culture/cards/*.svg`.
- Ready-to-post PNG images: `pop-culture/cards/*.png`, automatically rendered and committed by the image workflow.
- Content catalog and captions: `pop-culture/questions.json`.
- Image scheduling: `src/pop-culture-images.js` through `.github/workflows/pop-culture-images.yml`.
- Facebook: **2 images per day at 09:00 and 21:00 Morocco local time**, separately from the existing four daily Reels (00:00, 06:00, 12:00, 18:00).
- The job checks Buffer's queue, persists a separate `pop-culture/state.json` ledger and limits new scheduled image posts to 2 per run, with no automatic retries after uncertain API results.
- Public media URL: `https://raw.githubusercontent.com/mouadchag358/buffer-shorts/main/pop-culture/cards/<id>.png` (repo must remain public).
- On initial push, images are rendered but **not** sent to Buffer; on subsequent scheduled runs it fills the future queue. For a safe preview: trigger the workflow manually with `dry_run=true`.
- The existing video state (`state.json`), `posts.json`, R2 media, three video channels and all Reels workflows are not modified.
- All graphics are original abstract typographic designs, not copied movie/anime screenshots or protected character artwork. Quiz answers are stored in the JSON catalog for moderation, never shown on the graphic.

Use `npm test` to validate the content. The scheduler requires existing `BUFFER_API_KEY`, `BUFFER_ORGANIZATION_ID`, and `BUFFER_FACEBOOK_CHANNEL_ID` secrets/variables already used for Reels.
