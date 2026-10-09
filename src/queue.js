import { deliveryKey, inputFor, validate } from './core.js';
import { queueTargets, platformQueueTargets, localParts } from './queue-schedule.js';
const pending = p => ['scheduled', 'sending'].includes(p.status);
const accepted = d => ['queued', 'published', 'failed_in_buffer'].includes(d?.status);
// Les rejets explicites de format sont propres au réseau: on saute seulement
// ces vidéos incompatibles, sans masquer les autres refus Buffer.
const formatRejection = (delivery, platform) => {
  if (delivery?.status !== 'rejected') return false;
  const message = delivery.error || '';
  if (platform === 'youtube') return /Video must be vertical.*YouTube Shorts/i.test(message);
  if (platform === 'instagram') return /Video frame rate must be at least \d+(?:\.\d+)?\s*fps for Instagram Reels/i.test(message);
  return false;
};
const blocked = c => c.isQueuePaused || c.isDisconnected || c.isLocked;
export async function reconcileDeliveries({ state, remote, get, persist, now }) {
  const active = new Map(remote.map(p => [p.id, p]));
  let reads = 0;
  for (const delivery of Object.values(state.deliveries)) {
    if (!delivery.bufferId || delivery.status !== 'queued') continue;
    let post = active.get(delivery.bufferId);
    if (!post) {
      if (++reads > 24) throw new Error('Limite de 24 lectures de réconciliation atteinte');
      post = await get(delivery.bufferId);
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
  const byId = new Map(Object.entries(state.deliveries).filter(([, d]) => d.bufferId).map(([key, d]) => [d.bufferId, { key, delivery: d }]));

  for (const post of remote) {
    const record = byId.get(post.id), channel = channels.find(c => c.id === post.channelId);
    if (!record || !channel || blocked(channel) || post.status !== 'scheduled' || !post.dueAt) continue;

    const platform = channel.service;
    const currentParts = localParts(new Date(post.dueAt));
    const currentDay = `${currentParts.year}-${currentParts.month}-${currentParts.day}`;
    const nowParts = localParts(now);
    const today = `${nowParts.year}-${nowParts.month}-${nowParts.day}`;

    let needsMove = false;
    if (platform === 'instagram' || platform === 'facebook') {
      needsMove = currentParts.minute !== '00';
    } else if (['youtube', 'tiktok'].includes(platform)) {
      needsMove = currentDay === today || currentParts.minute !== '00' || !['00', '06', '12', '18'].includes(currentParts.hour);
    } else {
      continue;
    }

    if (!needsMove) continue;

    const occupied = new Set(remote.filter(other => other.id !== post.id && other.channelId === channel.id && pending(other)).map(other => other.dueAt));
    const target = platformQueueTargets(now, platform, 10).find(t => !occupied.has(t.dueAt));
    if (!target) throw new Error('Aucun créneau libre pour la migration');
    if (remote.some(other => other.id !== post.id && other.channelId === channel.id && other.dueAt === target.dueAt)) throw new Error('Collision de créneaux pendant la migration');

    if (!dryRun) {
      record.delivery.scheduleUpdate = { status: 'pending', dueAt: target.dueAt };
      await persist(state);
      const sourceId = JSON.parse(record.key)[0];
      const source = posts.find(p => p.id === sourceId);
      if (!source) throw new Error('Source vidéo introuvable pour déplacer le post');
      const { channelId, needsApproval, mode, ...content } = inputFor(source, platform, env);
      const result = await edit(post.id, target.dueAt, { ...content, text: post.text ?? content.text });
      if (result.status !== 'scheduled' || Date.parse(result.dueAt) !== Date.parse(target.dueAt)) throw new Error('Horaire Buffer non confirmé après modification');
      Object.assign(record.delivery, { dueAt: target.dueAt, bufferStatus: result.status, scheduleUpdate: { status: 'done', dueAt: target.dueAt } });
      await persist(state);
    }

    post.dueAt = target.dueAt;
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
    if (!channel || !['youtube', 'tiktok'].includes(channel.service)) continue;

    const record = byBufferId.get(remotePost.id);
    if (!record) continue;
    const [postId, platform] = JSON.parse(record.key);
    if (platform !== channel.service) continue;

    const source = posts.find(post => post.id === postId);
    if (!source) continue;

    const { channelId, needsApproval, mode, ...content } = inputFor(source, platform, env);
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

export async function fillQueues({ posts, state, remote, channels, env, persist, send, now = new Date(), dryRun = false, log = console.log }) {
  validate(posts);
  if (state.version !== 1 || !state.slots || !state.deliveries) throw new Error('État invalide');
  if (Object.values(state.deliveries).some(d => ['sending', 'uncertain'].includes(d.status))) throw new Error('Envoi incertain: vérifier Buffer avant toute nouvelle création');
  const working = dryRun ? structuredClone(state) : state;
  let attempts = 0;
  const summaries = [];
  for (const channel of channels) {
    const platform = channel.service;
    const queued = remote.filter(p => p.channelId === channel.id && pending(p));
    const summary = { platform, queued: queued.length, added: 0, rejected: 0, attempts: 0, errors: [], dueAt: queued.map(p => p.dueAt) };
    summaries.push(summary);
    if (blocked(channel)) { summary.errors.push('Compte déconnecté, verrouillé ou en pause'); continue; }
    const queueGoal = platform === 'instagram' ? 8 : 8;
    while (summary.queued < queueGoal && summary.attempts < 12 && attempts < 30) {
      // Un refus explicite de format ne bloque pas le réseau: passer à la prochaine vidéo.
      const post = posts.find(p => p.enabled !== false && p.platforms.includes(platform) && !accepted(working.deliveries[deliveryKey(p.id, platform)]) && !formatRejection(working.deliveries[deliveryKey(p.id, platform)], platform));
      if (!post) { summary.errors.push('Plus de vidéos disponibles'); break; }
      const key = deliveryKey(post.id, platform);
      const input = inputFor(post, platform, env);
      const existing = remote.find(p => p.channelId === channel.id && p.assets?.some(a => a.source === input.assets[0].video.url));
      if (existing) { working.deliveries[key] = { status: 'queued', bufferId: existing.id, channelId: channel.id, dueAt: existing.dueAt, bufferStatus: existing.status }; if (!dryRun) await persist(state); continue; }
      const occupied = new Set(remote.filter(p => p.channelId === channel.id && pending(p)).map(p => p.dueAt));
      const target = platformQueueTargets(now, platform, 10).find(t => !occupied.has(t.dueAt));
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
