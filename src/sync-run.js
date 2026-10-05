import { readFile, writeFile, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolveQueueChannels } from './discovery.js';
import { queuedPosts, getPost, reschedulePost, createPost } from './buffer.js';
import { loadCatalog } from './catalog.js';
import { reconcileDeliveries, migrateOldSlots, fillQueues } from './queue.js';
import { syncDue } from './queue-schedule.js';
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const dryRun = process.argv.includes('--dry-run');
async function persist(state) {
  await writeFile('state.json.tmp', JSON.stringify(state, null, 2) + '\n');
  await rename('state.json.tmp', 'state.json');
  if (process.env.PERSIST_GIT === 'true') {
    execFileSync('git', ['add', 'state.json', 'posts.json'], { stdio: 'inherit' });
    try { execFileSync('git', ['diff', '--cached', '--quiet']); return; }
    catch (error) { if (error.status !== 1) throw error; }
    execFileSync('git', ['commit', '-m', 'Record Buffer queue checkpoint [skip ci]'], { stdio: 'inherit' });
    execFileSync('git', ['push', 'origin', 'HEAD'], { stdio: 'inherit' });
  }
}
try {
  const now = new Date(), state = await read('state.json');
  const forced = process.argv.includes('--force') || process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
  const request = process.argv.includes('--force') ? await read('.github/requests/sync.json') : null;
  if (request && !/^[a-zA-Z0-9_-]{1,100}$/.test(request.id || '')) throw new Error('Demande de synchronisation invalide');
  if (!dryRun && request && state.queueSync?.completedRequestId === request.id) { console.log('Demande déjà effectuée; aucun appel réseau'); process.exit(0); }
  if (!dryRun && !forced && !syncDue(state, now.getTime())) { console.log('Moins de 12 heures depuis le dernier passage: aucun appel Buffer ou R2'); process.exit(0); }
  if (Object.values(state.deliveries).some(d => ['sending', 'uncertain'].includes(d.status))) throw new Error('Envoi incertain: vérifier Buffer avant de continuer');
  if (!dryRun) {
    state.queueSync = { ...state.queueSync, lastAttemptAt: now.toISOString(), status: 'running' };
    await persist(state); // Une erreur compte aussi comme passage; pas de rafale horaire.
  }
  const { env, channels } = await resolveQueueChannels(['tiktok', 'instagram', 'youtube']);
  const remote = await queuedPosts(env.BUFFER_ORGANIZATION_ID, channels.map(c => c.id), env);
  if (!dryRun) await reconcileDeliveries({ state, remote, get: id => getPost(id, env), persist, now });
  const existingPosts = await read('posts.json');
  await migrateOldSlots({ state, remote, channels, posts: existingPosts, env, edit: (id, dueAt, content) => reschedulePost(id, dueAt, env, undefined, content), persist, now, dryRun });
  // L'existence des objets est confirmée par le catalogue R2. Buffer valide la vidéo
  // lors de createPost; aucun HEAD supplémentaire dans le remplissage des files.
  const posts = dryRun ? (state.catalog?.posts || await read('posts.json')) : await loadCatalog({ state, persist, env });
  if (!dryRun && JSON.stringify(await read('posts.json')) !== JSON.stringify(posts)) {
    await writeFile('posts.json', JSON.stringify(posts, null, 2) + '\n'); await persist(state);
  }
  const summaries = await fillQueues({ posts, state, remote, channels, env, persist, send: input => createPost(input, env), now, dryRun });
  const complete = summaries.every(s => s.queued >= 4 && !s.errors.length);
  if (!dryRun) {
    state.queueSync = { ...state.queueSync, status: complete ? 'complete' : 'partial', lastCompletedAt: now.toISOString(), summaries,
      ...(request && complete ? { completedRequestId: request.id } : {}) };
    await persist(state);
  }
  console.log(`${dryRun ? 'Simulation' : 'Synchronisation'}: objectif 4 vidéos par réseau, créneaux 23h00/00h20/01h40/03h00, intervalle 12h`);
  if (!complete) throw new Error('Files incomplètes: consulter les résultats par réseau');
} catch (error) { console.error(error.message); process.exitCode = 1; }
