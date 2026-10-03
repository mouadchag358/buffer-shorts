import { readFile, writeFile, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { processSlot } from './core.js';
import { createPost } from './buffer.js';
import { mediaChecker } from './media.js';
import { loadCatalog } from './catalog.js';
import { discoverChannels } from './discovery.js';
import { nextPublication } from './schedule.js';
const dryRun = process.argv.includes('--dry-run');
const read = async path => JSON.parse(await readFile(path, 'utf8'));
async function persist(state) {
  await writeFile('state.json.tmp', JSON.stringify(state, null, 2) + '\n');
  await rename('state.json.tmp', 'state.json');
  if (process.env.PERSIST_GIT === 'true') {
    execFileSync('git', ['add', 'state.json', 'posts.json'], { stdio: 'inherit' });
    execFileSync('git', ['commit', '-m', 'Record Buffer delivery checkpoint [skip ci]'], { stdio: 'inherit' });
    execFileSync('git', ['push', 'origin', 'HEAD'], { stdio: 'inherit' });
  }
}

try {
  const target = nextPublication(new Date(), process.env.GITHUB_EVENT_NAME === 'schedule');
  if (!target) { console.log('Aucun créneau à préparer; aucun appel réseau'); process.exit(0); }
  const state = await read('state.json');
  if (Object.values(state.deliveries || {}).some(d => ['sending', 'uncertain'].includes(d.status))) throw new Error('Envoi incertain: vérifier Buffer puis corriger state.json');
  const assigned = state.slots?.[target.key];
  if (assigned) {
    const existing = (await read('posts.json')).find(p => p.id === assigned);
    if (existing && existing.platforms.every(p => state.deliveries[JSON.stringify([assigned, p])]?.status === 'queued')) {
      console.log('Créneau déjà préparé; aucun appel réseau'); process.exit(0);
    }
  }
  const posts = await loadCatalog({ state, persist });
  if (JSON.stringify(await read('posts.json')) !== JSON.stringify(posts)) {
    await writeFile('posts.json', JSON.stringify(posts, null, 2) + '\n'); await persist(state);
  }
  const next = assigned ? posts.find(p => p.id === assigned) : posts.find(p => p.platforms.some(platform => state.deliveries[JSON.stringify([p.id, platform])]?.status !== 'queued'));
  if (!next) { console.log('Aucune vidéo restante'); process.exit(0); }
  const env = await discoverChannels(next.platforms);
  const checkMedia = mediaChecker({ state, persist });
  const work = await processSlot({ posts, state, slot: target.key, dueAt: target.dueAt, env, persist, send: input => createPost(input, env), checkMedia, dryRun });
  console.log(`${dryRun ? 'Simulation' : 'Programmation'}: ${work.length} destination(s), ${target.key}, ${target.dueAt}`);
  for (const item of work) console.log(item.platform);
} catch (error) { console.error(error.message); process.exitCode = 1; }
