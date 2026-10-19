// Restore per-page keys without erasing records of already sent Facebook Reels.
export function migrateFacebookDeliveryKeys(state, originalFacebookId) {
  if (!originalFacebookId) return false;
  let migrated = false;
  for (const [key, delivery] of Object.entries(state.deliveries || {})) {
    let parsed;
    try { parsed = JSON.parse(key); } catch { continue; }
    if (!Array.isArray(parsed) || parsed.length !== 2 || parsed[1] !== 'facebook') continue;
    if (delivery.channelId && delivery.channelId !== originalFacebookId)
      throw new Error('Page Facebook historique differente de la page d origine: migration arretee pour eviter les doublons');
    const destinationKey = JSON.stringify([parsed[0], 'facebook:' + originalFacebookId]);
    if (state.deliveries[destinationKey]) {
      if (state.deliveries[destinationKey].bufferId !== delivery.bufferId ||
          state.deliveries[destinationKey].status !== delivery.status)
        throw new Error('Checkpoints Facebook contradictoires: verification manuelle requise');
      delete state.deliveries[key];
      migrated = true;
      continue;
    }
    state.deliveries[destinationKey] = delivery;
    delete state.deliveries[key];
    migrated = true;
  }
  return migrated;
}
