import { deliveryKey, inputFor, validate } from './core.js';
import { platformQueueTargets, isPlannedVideoSlot, videoHourKey } from './queue-schedule.js';
const pending = p => ['scheduled', 'sending'].includes(p.status);
const accepted = d => ['queued', 'published', 'failed_in_buffer', 'missing_in_buffer'].includes(d?.status);
// Les rejets explicites de format sont propres au réseau: on saute seulement
// ces vidéos incompatibles, sans masquer les autres refus Buffer.
const formatRejection = (delivery, platform) => {
  if (delivery?.status !== 'rejected') return false;
  const message = delivery.error || '';
  if (platform === 'youtube') return /Video must be vertical.*YouTube Shorts/i.test(message);
  if (platform === 'instagram') return /Video frame rate must be at least \d+(?:\.\d+)?\s*fps for Instagram Reels/i.test(message);
  if (platform === 'facebook') return /Video (?:height|width) must be at least \d+px for Facebook Reels|Video aspect ratio is too (?:narrow|wide) for Facebook Reels|Video must be no longer than 1m\s*30s for Facebook Reels/i.test(message);
  return false;
};
const blocked = c => c.isQueuePaused || c.isDisconnected || c.isLocked;
// Image posts are handled by a separate scheduler; do not count them as Reels.
const imageOnly = post => Array.isArray(post.assets) && post.assets.length > 0 &&
  post.assets.every(asset => /\.(?:png|jpe?g|webp|gif)(?:[?#]|$)/i.test(asset.source || ''));

export async function reconcileDeliveries({ state, remote, get, persist, now, channels }) {
  const active = new Map(remote.map(p => [p.id, p]));
  let reads = 0;
  const enabledChannels = channels ? new Set(channels.map(channel => channel.id)) : null;
  for (const delivery of Object.values(state.deliveries)) {
    // Old TikTok checkpoints are no longer part of the selected channels.
    if (enabledChannels && !enabledChannels.has(delivery.channelId)) continue;
    if (!delivery.bufferId || delivery.status !== 'queued') continue;
    let post = active.get(delivery.bufferId);
    if (!post) {
      if (++reads > 24) throw new Error('Limite de 24 lectures de réconciliation atteinte');
      try {
        post = await get(delivery.bufferId);
      } catch (error) {
        if (error?.code !== 'BUFFER_POST_NOT_FOUND') throw error;
        // Never silently post this source again: it may have been published
        // before Buffer removed its historical record.
        Object.assign(delivery, {
          status: 'missing_in_buffer',
          error: 'Ancien post absent de Buffer; republication désactivée pour éviter un doublon',
          lastCheckedAt: now.toISOString()
        });
        await persist(state);
        continue;
      }
      if (pending(post)) { remote.push(post); active.set(post.id, post); }
    }
    Object.assign(delivery, { bufferStatus: post.status, dueAt: post.dueAt, lastCheckedAt: now.toISOString() });
    if (post.status === 'sent') Object.assign(delivery, { status: 'published', externalLink: post.externalLink, sentAt: post.sentAt });
    else if (post.status === 'error') Object.assign(delivery, { status: 'failed_in_buffer', error: post.error?.message || 'Échec de publication dans Buffer' });
    else if (!pending(post)) throw new Error(`Post ${post.id} dans un état ${post.status}: vérifier Buffer`);
  }
  await persist(state);
}
export async function migrateOldSlots({ state, remote, channels, edit, persist, now, dryRun = false, posts = [], env = {} }) {
  const byId = new Map(Object.entries(state.deliveries)
    .filter(([, delivery]) => delivery.bufferId)
    .map(([key, delivery]) => [delivery.bufferId, { key, delivery }]));
  const nowMs = new Date(now).getTime();

  for (const channel of channels) {
    if (blocked(channel)) continue;
    const platform = channel.service;
    if (!['facebook', 'instagram', 'youtube', 'tiktok'].includes(platform)) continue;

    const scheduled = remote
      .filter(post => post.channelId === channel.id && pending(post) && post.dueAt && !imageOnly(post) &&
        Number.isFinite(Date.parse(post.dueAt)) && Date.parse(post.dueAt) > nowMs + 10 * 60000)
      .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.id.localeCompare(b.id));
    const reserved = new Set();
    const needMove = [];

    // Never change external posts; also reserve their entire local hour to
    // avoid a collision with a freshly generated randomized video slot.
    for (const post of scheduled) {
      if (byId.has(post.id) && post.status === 'scheduled') continue;
      reserved.add(videoHourKey(post.dueAt));
    }

    // Preserve bot posts already at today's deterministic random targets.
    // Other bot posts are rescheduled via Buffer edit (never recreated).
    for (const post of scheduled) {
      if (!byId.has(post.id) || post.status !== 'scheduled') continue;
      const key = videoHourKey(post.dueAt);
      if (isPlannedVideoSlot(post.dueAt, channel.deliveryPlatform || platform) && !reserved.has(key)) {
        reserved.add(key);
      } else {
        needMove.push(post);
      }
    }

    if (!needMove.length) continue;
    const candidates = platformQueueTargets(now, channel.deliveryPlatform || platform, 32);
    for (const post of needMove) {
      const target = candidates.find(slot => !reserved.has(videoHourKey(slot.dueAt)));
      if (!target) throw new Error('No unique future video slot available for migration');
      const record = byId.get(post.id);
      const sourceId = JSON.parse(record.key)[0];
      const source = posts.find(p => p.id === sourceId);
      if (!source) throw new Error(`Original video not found for safe rescheduling: ${post.id}`);

      if (!dryRun) {
        record.delivery.scheduleUpdate = { status: 'pending', dueAt: target.dueAt };
        await persist(state);
        const { channelId, needsApproval, mode, ...content } = inputFor(source, channel.service, env);
        const result = await edit(post.id, target.dueAt, { ...content, text: post.text ?? content.text });
        if (result.status !== 'scheduled' || Date.parse(result.dueAt) !== Date.parse(target.dueAt))
          throw new Error('Buffer did not confirm rescheduled video; stopping safely');
        Object.assign(record.delivery, {
          dueAt: target.dueAt, bufferStatus: result.status,
          scheduleUpdate: { status: 'done', dueAt: target.dueAt }
        });
        await persist(state);
      }

      post.dueAt = target.dueAt;
      reserved.add(videoHourKey(target.dueAt));
    }
  }
}

export async function refreshScheduledDescriptions({ posts, state, remote, channels, env, edit, persist, dryRun = false }) {
  const channelById = new Map(channels.map(channel => [channel.id, channel]));
  const byBufferId = new Map(
    Object.entries(state.deliveries || {})
      .filter(([, delivery]) => delivery?.bufferId)
      .map(([key, delivery]) => [delivery.bufferId, { key, delivery }])
  );
  let updated = 0;

  for (const remotePost of remote) {
    if (remotePost.status !== 'scheduled') continue;
    const channel = channelById.get(remotePost.channelId);
    if (!channel || !['youtube', 'tiktok', 'facebook'].includes(channel.service)) continue;

    const record = byBufferId.get(remotePost.id);
    if (!record) continue;
    const [postId, platform] = JSON.parse(record.key);
    if (platform !== (channel.deliveryPlatform || channel.service)) continue;

    const source = posts.find(post => post.id === postId);
    if (!source) continue;

    const { channelId, needsApproval, mode, ...content } = inputFor(source, channel.service, env);
    const desiredText = content.text;
    const desiredYoutubeTitle = platform === 'youtube' ? content.metadata?.youtube?.title : null;
    const textNeedsUpdate = Boolean(desiredText) && remotePost.text !== desiredText;
    const titleNeedsUpdate = platform === 'youtube'
      && Boolean(desiredYoutubeTitle)
      && record.delivery.youtubeTitleUpdatedTo !== desiredYoutubeTitle;
    if (!textNeedsUpdate && !titleNeedsUpdate) continue;

    if (!dryRun) {
      const result = await edit(remotePost.id, remotePost.dueAt, { ...content, text: desiredText });
      if (result.status !== 'scheduled') throw new Error(`Modification Buffer non confirmée: ${remotePost.id}`);
      if (textNeedsUpdate) record.delivery.descriptionUpdatedAt = new Date().toISOString();
      if (titleNeedsUpdate) record.delivery.youtubeTitleUpdatedTo = desiredYoutubeTitle;
      await persist(state);
    }

    remotePost.text = desiredText;
    updated++;
  }

  return updated;
}


// Initialise Facebook UNE SEULE FOIS à partir du dernier Reel Instagram confirmé.
// Le checkpoint conserve les IDs ignorés pour ne pas rejouer le vieux catalogue,
// même si de nouvelles vidéos sont ajoutées dans R2 ultérieurement.
export async function initFacebookFromInstagram({ posts, state, persist, dryRun = false }) {
  if (state.resume?.facebookFromInstagram) return state.resume.facebookFromInstagram;
  if (Object.keys(state.deliveries).some(key => {
    try { return String(JSON.parse(key)[1]).startsWith('facebook'); } catch { return false; }
  })) return null; // Une page ayant déjà commencé ne doit pas être réinitialisée.

  const instagram = Object.entries(state.deliveries).flatMap(([key, delivery]) => {
    try {
      const [id, network] = JSON.parse(key);
      return network === 'instagram' && delivery.status === 'published' && delivery.sentAt
        ? [{ id, sentAt: delivery.sentAt }] : [];
    } catch { return []; }
  });
  if (!instagram.length) return null;
  instagram.sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));
  const latest = instagram[0];
  const position = posts.findIndex(post => post.id === latest.id);
  if (position < 0) throw new Error('Dernière vidéo Instagram absente du catalogue R2 : reprise Facebook bloquée');

  const skipped = new Set(posts.slice(0, position + 1).map(post => post.id));
  // Also skip any older Instagram videos outside the current lexical sequence.
  instagram.forEach(delivery => skipped.add(delivery.id));
  const checkpoint = {
    lastInstagramPostId: latest.id,
    lastInstagramSentAt: latest.sentAt,
    skippedPostIds: [...skipped]
  };
  state.resume = { ...state.resume, facebookFromInstagram: checkpoint };
  if (!dryRun) await persist(state);
  return checkpoint;
}

export async function fillQueues({ posts, state, remote, channels, env, persist, send, now = new Date(), dryRun = false, log = console.log, targetQueueSize = 8 }) {
  validate(posts);
  if (!Number.isInteger(targetQueueSize) || targetQueueSize < 1 || targetQueueSize > 10) throw new Error('Réserve vidéo invalide (maximum 10)');
  if (state.version !== 1 || !state.slots || !state.deliveries) throw new Error('État invalide');
  if (Object.values(state.deliveries).some(d => ['sending', 'uncertain'].includes(d.status))) throw new Error('Envoi incertain: vérifier Buffer avant toute nouvelle création');
  const working = dryRun ? structuredClone(state) : state;
  const resume = channels.some(c => c.service === 'facebook')
    ? await initFacebookFromInstagram({ posts, state: working, persist, dryRun })
    : null;
  const facebookSkipped = new Set(resume?.skippedPostIds || []);
  let attempts = 0;
  const summaries = [];
  // Facebook rejects many low-resolution source videos. Limit trials but
  // continue past explicit per-file format errors to find 8 valid Reels.
  const maxTotalAttempts = 240;
  for (const channel of channels) {
    const platform = channel.service;
    const deliveryPlatform = channel.deliveryPlatform || platform;
    const queued = remote.filter(p => p.channelId === channel.id && pending(p) && !imageOnly(p));
    const summary = { platform, channelId: channel.id, queued: queued.length, added: 0, rejected: 0, attempts: 0, errors: [], dueAt: queued.map(p => p.dueAt) };
    summaries.push(summary);
    if (blocked(channel)) { summary.errors.push('Compte déconnecté, verrouillé ou en pause'); continue; }
    const queueGoal = targetQueueSize;
    const maxPlatformAttempts = platform === 'facebook' ? 96 : 12;
    while (summary.queued < queueGoal && summary.attempts < maxPlatformAttempts && attempts < maxTotalAttempts) {
      // Un refus explicite de format ne bloque pas le réseau: passer à la prochaine vidéo.
      const post = posts.find(p => p.enabled !== false && p.platforms.includes(platform) && (platform !== 'facebook' || !facebookSkipped.has(p.id)) && !accepted(working.deliveries[deliveryKey(p.id, deliveryPlatform)]) && !formatRejection(working.deliveries[deliveryKey(p.id, deliveryPlatform)], platform));
      if (!post) { summary.errors.push('Plus de vidéos disponibles'); break; }
      const key = deliveryKey(post.id, deliveryPlatform);
      const input = { ...inputFor(post, platform, env), channelId: channel.id };
      const existing = remote.find(p => p.channelId === channel.id && p.assets?.some(a => a.source === input.assets[0].video.url));
      if (existing) { working.deliveries[key] = { status: 'queued', bufferId: existing.id, channelId: channel.id, dueAt: existing.dueAt, bufferStatus: existing.status }; if (!dryRun) await persist(state); continue; }
      const occupied = new Set(remote.filter(p => p.channelId === channel.id && pending(p) && !imageOnly(p) && p.dueAt)
        .map(p => videoHourKey(p.dueAt)));
      const target = platformQueueTargets(now, deliveryPlatform, 32).find(t => !occupied.has(videoHourKey(t.dueAt)));
      if (!target) throw new Error('Aucun créneau libre');
      Object.assign(input, { mode: 'customScheduled', dueAt: target.dueAt });
      attempts++; summary.attempts++;
      let result;
      if (dryRun) result = { status: 'queued', bufferId: `simulation-${attempts}` };
      else {
        working.deliveries[key] = { status: 'sending', channelId: channel.id, dueAt: target.dueAt, updatedAt: now.toISOString() };
        await persist(state);
        try { result = await send(input); }
        catch { result = { status: 'uncertain', error: 'Vérifier Buffer avant toute nouvelle tentative' }; }
      }
      working.deliveries[key] = { ...working.deliveries[key], ...result, channelId: channel.id, dueAt: target.dueAt, updatedAt: now.toISOString() };
      if (!dryRun) await persist(state);
      if (result.status === 'uncertain') throw new Error(`Envoi incertain: ${platform}/${post.id}`);
      if (result.status === 'queued') {
        remote.push({ id: result.bufferId, channelId: channel.id, status: 'scheduled', dueAt: target.dueAt, assets: [{ source: input.assets[0].video.url }] });
        summary.queued++; summary.added++; summary.dueAt.push(target.dueAt);
      } else {
        summary.rejected++;
        if (!formatRejection(result, platform)) { summary.errors.push(result.error || 'Refus Buffer'); break; }
      }
    }
    if (summary.queued < queueGoal && !summary.errors.length) summary.errors.push('Budget de tentatives atteint');
    log(JSON.stringify(summary));
  }
  return summaries;
}
