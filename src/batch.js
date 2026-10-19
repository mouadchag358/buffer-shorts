import { processSlot, deliveryKey, isFinalDelivery } from './core.js';
export function slotComplete(state, posts, target, channels) {
  const id = state.slots?.[target.key], post = posts.find(p => p.id === id);
  return Boolean(post && post.platforms.every(platform => {
    const destinations = Array.isArray(channels)
      ? channels.filter(ch => ch.service === platform).map(ch => ch.deliveryPlatform || ch.service)
      : [platform];
    return destinations.length > 0 && destinations.every(key =>
      isFinalDelivery(state.deliveries[deliveryKey(id, key)]));
  }));
}
export async function processTargets({ targets, log = console.log, ...options }) {
  // La simulation sélectionne aussi deux vidéos distinctes, sans sauvegarder les faux résultats.
  const state = options.dryRun ? structuredClone(options.state) : options.state;
  const results = [];
  for (const target of targets) {
    if (slotComplete(state, options.posts, target, options.channels)) { log(`Créneau déjà préparé: ${target.key}`); continue; }
    let work;
    try { work = await processSlot({ ...options, state, slot: target.key, dueAt: target.dueAt }); }
    catch (error) {
      // Seul le refus définitif des Shorts horizontaux permet de continuer.
      if (!slotComplete(state, options.posts, target, options.channels)) throw error;
      log(error.message);
      continue;
    }
    if (options.dryRun && work.length) {
      await options.checkMedia(work[0].input.assets[0].video.url);
      const assigned = state.slots[target.key];
      const post = assigned ? options.posts.find(p => p.id === assigned) : options.posts.find(p => p.enabled !== false && p.platforms.some(platform => (options.channels ? options.channels.filter(ch => ch.service === platform).map(ch => ch.deliveryPlatform || ch.service) : [platform]).some(key => !isFinalDelivery(state.deliveries[deliveryKey(p.id, key)]))));
      state.slots[target.key] = post.id;
      for (const item of work) state.deliveries[deliveryKey(post.id, item.platform)] = { status: 'queued' };
    }
    log(`${options.dryRun ? 'Simulation' : 'Acceptation Buffer'}: ${work.length} destination(s), ${target.key}, ${target.dueAt || 'immédiat'}`);
    results.push({ target, work });
  }
  return results;
}
