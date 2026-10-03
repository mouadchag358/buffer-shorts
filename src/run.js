import { readFile, writeFile, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { processSlot, slotKey } from './core.js';
import { createPost } from './buffer.js';
import { mediaChecker } from './media.js';
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

try {
  const state = await read('state.json');
  const checkMedia = mediaChecker({ state, persist });
  const work = await processSlot({ posts: await read('posts.json'), state, slot: slotKey(), env: process.env, persist, send: input => createPost(input, process.env), checkMedia, dryRun });
  console.log(`${dryRun ? 'Simulation' : 'Envoi'}: ${work.length} destination(s)`);
  for (const item of work) console.log(item.platform);
} catch (error) { console.error(error.message); process.exitCode = 1; }
