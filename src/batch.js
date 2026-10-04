import { processSlot, deliveryKey, isFinalDelivery } from './core.js';
export function slotComplete(state, posts, target) {
  const id = state.slots?.[target.key], post = posts.find(p => p.id === id);
  return Boolean(post && post.platforms.every(p => isFinalDelivery(state.deliveries[deliveryKey(id, p)])));
}
export async function processTargets({ targets, log = console.log, ...options }) {
  // La simulation sélectionne aussi deux vidéos distinctes, sans sauvegarder les faux résultats.
  const state = options.dryRun ? structuredClone(options.state) : options.state;
  const results = [];
  for (const target of targets) {
    if (slotComplete(state, options.posts, target)) { log(`Créneau déjà préparé: ${target.key}`); continue; }
    let work;
    try { work = await processSlot({ ...options, state, slot: target.key, dueAt: target.dueAt }); }
    catch (error) {
      // Seul le refus définitif des Shorts horizontaux permet de continuer.
      if (!slotComplete(state, options.posts, target)) throw error;
      log(error.message);
      continue;
    }
    if (options.dryRun && work.length) {
      await options.checkMedia(work[0].input.assets[0].video.url);
      const assigned = state.slots[target.key];
      const post = assigned ? options.posts.find(p => p.id === assigned) : options.posts.find(p => p.enabled !== false && p.platforms.some(platform => !isFinalDelivery(state.deliveries[deliveryKey(p.id, platform)])));
      state.slots[target.key] = post.id;
      for (const item of work) state.deliveries[deliveryKey(post.id, item.platform)] = { status: 'queued' };
    }
    log(`${options.dryRun ? 'Simulation' : 'Acceptation Buffer'}: ${work.length} destination(s), ${target.key}, ${target.dueAt || 'immédiat'}`);
    results.push({ target, work });
  }
  return results;
}
