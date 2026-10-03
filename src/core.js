const platforms = ['tiktok', 'youtube', 'facebook', 'instagram'];
export const deliveryKey = (id, platform) => JSON.stringify([id, platform]);
export function slotKey(now = new Date()) {
  return `${now.toISOString().slice(0, 10)}-${now.getUTCHours() < 12 ? 'morning' : 'evening'}`;
}
export function videoTitle(post) {
  const custom = post.youtube?.title ?? post.title;
  if (custom !== undefined && typeof custom !== 'string') throw new Error(`Titre invalide: ${post.id}`);
  if (custom?.trim()) return custom.trim();
  return '#fyp #fy #viral #ai';
}
export function validate(posts) {
  if (!Array.isArray(posts)) throw new Error('posts.json doit être une liste');
  const ids = new Set();
  for (const p of posts) {
    if (typeof p.id !== 'string' || !p.id || ids.has(p.id)) throw new Error('ID manquant ou dupliqué');
    ids.add(p.id);
    if (p.enabled === false) continue;
    if (!Array.isArray(p.platforms) || !p.platforms.length || new Set(p.platforms).size !== p.platforms.length || p.platforms.some(x => !platforms.includes(x))) throw new Error(`Plateformes invalides: ${p.id}`);
    if (!p.url && (!p.file || p.file.startsWith('/') || p.file.split('/').includes('..'))) throw new Error(`Fichier invalide: ${p.id}`);
    if (p.platforms.includes('youtube') && (!videoTitle(p) || videoTitle(p).length > 100)) throw new Error(`Titre YouTube invalide: ${p.id}`);
  }
}
export function inputFor(post, platform, env) {
  const channelId = env[`BUFFER_${platform.toUpperCase()}_CHANNEL_ID`];
  if (!channelId) throw new Error(`Channel ID manquant: ${platform}`);
  const base = env.R2_PUBLIC_BASE_URL;
  if (!post.url && !base) throw new Error('R2_PUBLIC_BASE_URL manquante');
  const url = post.url || `${base.replace(/\/$/, '')}/${post.file.split('/').map(encodeURIComponent).join('/')}`;
  if (new URL(url).protocol !== 'https:') throw new Error('La vidéo doit avoir une URL HTTPS');
  const input = { channelId, text: post.text || videoTitle(post), schedulingType: 'automatic', mode: 'addToQueue', needsApproval: false, assets: [{ video: { url } }] };
  if (platform === 'youtube') input.metadata = { youtube: { categoryId: '22', madeForKids: false, privacy: 'public', ...post.youtube, title: videoTitle(post), isAiGenerated: post.isAiGenerated === true } };
  if (platform === 'tiktok') input.metadata = { tiktok: { isAiGenerated: post.isAiGenerated === true } };
  if (platform === 'instagram') input.metadata = { instagram: { type: 'reel', shouldShareToFeed: true, isAiGenerated: post.isAiGenerated === true } };
  return input;
}
export async function processSlot({ posts, state, slot, env, persist, send, checkMedia, dryRun = false, dueAt, mode }) {
  validate(posts);
  if (state.version !== 1 || !state.slots || !state.deliveries) throw new Error('État invalide');
  if (Object.values(state.deliveries).some(d => ['sending', 'uncertain'].includes(d.status))) throw new Error('Envoi incertain: vérifier Buffer puis corriger state.json (voir README)');
  const assigned = state.slots[slot];
  const post = assigned ? posts.find(p => p.id === assigned) : posts.find(p => p.enabled !== false && p.platforms.some(platform => state.deliveries[deliveryKey(p.id, platform)]?.status !== 'queued'));
  if (!post) { if (assigned) throw new Error('Le post du créneau a été retiré'); return []; }
  if (post.enabled === false) return [];
  const work = post.platforms.filter(platform => state.deliveries[deliveryKey(post.id, platform)]?.status !== 'queued').map(platform => ({ platform, input: { ...inputFor(post, platform, env), ...(mode === 'shareNow' ? { mode: 'shareNow' } : dueAt ? { mode: 'customScheduled', dueAt } : {}) } }));
  if (!work.length || dryRun) return work;
  await checkMedia(work[0].input.assets[0].video.url);
  state.slots[slot] = post.id;
  for (const { platform, input } of work) {
    const key = deliveryKey(post.id, platform);
    state.deliveries[key] = { status: 'sending', channelId: input.channelId, updatedAt: new Date().toISOString() };
    await persist(state); // Journal durable AVANT l'appel: une interruption bloque les doublons.
    let result;
    try { result = await send(input); }
    catch { result = { status: 'uncertain', error: 'Vérifier Buffer avant de réessayer' }; }
    state.deliveries[key] = { ...state.deliveries[key], ...result, updatedAt: new Date().toISOString() };
    await persist(state);
    if (result.status !== 'queued') throw new Error(`Envoi ${result.status}: ${post.id}/${platform}. Consulter state.json.`);
  }
  return work;
}
