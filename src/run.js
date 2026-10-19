import { readFile, writeFile, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { slotComplete, processTargets } from './batch.js';
import { setTimeout as delay } from 'node:timers/promises';
import { createPost } from './buffer.js';
import { mediaChecker } from './media.js';
import { loadCatalog } from './catalog.js';
import { resolveQueueChannels } from './discovery.js';
import { migrateFacebookDeliveryKeys } from './checkpoints.js';
const dryRun = process.argv.includes('--dry-run');
const read = async path => JSON.parse(await readFile(path, 'utf8'));
async function persist(state) {
  await writeFile('state.json.tmp', JSON.stringify(state, null, 2) + '\n');
  await rename('state.json.tmp', 'state.json');
  if (process.env.PERSIST_GIT === 'true') {
    execFileSync('git', ['add', 'state.json', 'posts.json'], { stdio: 'inherit' });
    try { execFileSync('git', ['diff', '--cached', '--quiet']); return; }
    catch (error) { if (error.status !== 1) throw error; }
    execFileSync('git', ['commit', '-m', 'Record Buffer delivery checkpoint [skip ci]'], { stdio: 'inherit' });
    // Retenter uniquement le checkpoint Git, jamais l'envoi Buffer.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        execFileSync('git', ['push', 'origin', 'HEAD'], { stdio: 'inherit' });
        break;
      } catch (error) {
        if (attempt === 3) throw error;
        console.warn(`Git push refusé (tentative ${attempt}/3); nouvel essai sans nouvel envoi Buffer.`);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 3000);
      }
    }
  }
}

if (!process.argv.includes('--now')) {
  await import('./sync-run.js');
} else {
try {
  const publishNow = process.argv.includes('--now');
  const request = publishNow ? await read('.github/requests/publish-now.json') : null;
  if (publishNow && !/^[a-zA-Z0-9_-]{1,100}$/.test(request?.id || '')) throw new Error('Identifiant de demande immédiate invalide');
  const targets = [{ key: `manual-${request.id}` }];
  const state = await read('state.json');
  if (Object.values(state.deliveries || {}).some(d => ['sending', 'uncertain'].includes(d.status))) throw new Error('Envoi incertain: vérifier Buffer puis corriger state.json');
  const posts = await loadCatalog({ state, persist });
  if (JSON.stringify(await read('posts.json')) !== JSON.stringify(posts)) {
    await writeFile('posts.json', JSON.stringify(posts, null, 2) + '\n'); await persist(state);
  }
  const { env, channels } = await resolveQueueChannels(
    [...new Set(posts.filter(p => p.enabled !== false).flatMap(p => p.platforms))]
  );
  if (migrateFacebookDeliveryKeys(state, env.BUFFER_FACEBOOK_CHANNEL_ID)) await persist(state);
  if (targets.every(target => slotComplete(state, posts, target, channels))) {
    console.log('Créneaux déjà préparés pour toutes les pages; aucun nouvel envoi');
    process.exit(0);
  }
  const rawCheck = mediaChecker({ state, persist, maxPerRun: publishNow ? 1 : 2, extraRequestDay: publishNow ? request.extraMediaRequestDay : undefined });
  let lastCheck;
  const checkMedia = async url => {
    if (lastCheck) await delay(Math.max(0, 10000 - (Date.now() - lastCheck)));
    await rawCheck(url); lastCheck = Date.now();
  };
  await processTargets({ targets, posts, state, mode: publishNow ? 'shareNow' : undefined,
    env, channels, persist, send: input => createPost(input, env), checkMedia, dryRun });
} catch (error) { console.error(error.message); process.exitCode = 1; }
}
