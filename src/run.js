import { readFile, writeFile, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { processSlot, slotKey } from './core.js';
import { createPost } from './buffer.js';
const dryRun = process.argv.includes('--dry-run');
const read = async path => JSON.parse(await readFile(path, 'utf8'));
async function persist(state) {
  await writeFile('state.json.tmp', JSON.stringify(state, null, 2) + '\n');
  await rename('state.json.tmp', 'state.json');
  if (process.env.PERSIST_GIT === 'true') {
    execFileSync('git', ['add', 'state.json'], { stdio: 'inherit' });
    execFileSync('git', ['commit', '-m', 'Record Buffer delivery checkpoint [skip ci]'], { stdio: 'inherit' });
    execFileSync('git', ['push', 'origin', 'HEAD'], { stdio: 'inherit' });
  }
}
async function checkMedia(url) {
  const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(30000) });
  if (!response.ok || !(response.headers.get('content-type') || '').startsWith('video/')) throw new Error('URL vidéo inaccessible ou Content-Type différent de video/*');
}
try {
  const work = await processSlot({ posts: await read('posts.json'), state: await read('state.json'), slot: slotKey(), env: process.env, persist, send: input => createPost(input, process.env), checkMedia, dryRun });
  console.log(`${dryRun ? 'Simulation' : 'Envoi'}: ${work.length} destination(s)`);
  for (const item of work) console.log(item.platform);
} catch (error) { console.error(error.message); process.exitCode = 1; }
