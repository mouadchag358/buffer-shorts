const platforms = ['tiktok', 'youtube', 'facebook', 'instagram'];
export const isFinalDelivery = d => ['queued', 'published', 'failed_in_buffer'].includes(d?.status) || (d?.status === 'rejected' && /Video must be vertical.*YouTube Shorts/i.test(d.error || ''));
export const deliveryKey = (id, platform) => JSON.stringify([id, platform]);

const PLATFORM_HASHTAGS = {
  youtube: [
    '#Shorts #YouTubeShorts #Viral #Trending #AI',
    '#Shorts #ViralVideo #TrendingShorts #AIvideo #YouTubeShorts',
    '#YouTubeShorts #ShortsFeed #TrendingNow #Viral #AI'
  ],
  tiktok: [
    '#fyp #foryou #viral #trending #ai',
    '#foryoupage #viralvideo #tiktokviral #trending #ai',
    '#fyp #viral #trend #aitiktok #foryou'
  ]
};

function stableIndex(value, length) {
  let hash = 0;
  for (const char of String(value || '')) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return hash % length;
}

export function platformText(post, platform) {
  const custom = post.descriptions?.[platform];
  if (custom !== undefined) {
    if (typeof custom !== 'string') throw new Error(`Description invalide: ${post.id}/${platform}`);
    if (custom.trim()) return custom.trim();
  }
  const hashtags = PLATFORM_HASHTAGS[platform];
  if (hashtags) return hashtags[stableIndex(post.id || post.file || post.url, hashtags.length)];
  return post.text || videoTitle(post);
}
export function slotKey(now = new Date()) {
  return `${now.toISOString().slice(0, 10)}-${now.getUTCHours() < 12 ? 'morning' : 'evening'}`;
}
export function videoTitle(post) {
  const custom = post.youtube?.title ?? post.title;
  if (custom !== undefined && typeof custom !== 'string') throw new Error(`Titre invalide: ${post.id}`);
  if (custom?.trim()) return custom.trim();
  let filename = typeof post.file === 'string' ? post.file.split('/').pop() : '';
  if (!filename && post.url) {
    const basename = new URL(post.url).pathname.split('/').pop();
    try { filename = decodeURIComponent(basename); } catch { filename = basename; }
  }
  const clean = (filename || '').replace(/\.(mp4|mov|m4v|webm|mkv)$/i, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  let title = '';
  for (const char of clean) { if (title.length + char.length > 100) break; title += char; }
  return title.trim() || '#fyp #fy #viral #ai';
}

export function youtubeTitle(post) {
  const base = videoTitle(post).replace(/\s*#shorts\s*$/i, '').trim();
  const suffixes = [' 🔥 #Shorts', ' 👀 #Shorts', ' 😮 #Shorts'];
  const suffix = suffixes[stableIndex(post.id || post.file || post.url, suffixes.length)];
  let result = '';
  const maxBaseLength = 100 - suffix.length;
  for (const char of base) {
    if (result.length + char.length > maxBaseLength) break;
    result += char;
  }
  return (result.trim() || 'Short').trim() + suffix;
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
    if (p.platforms.includes('youtube') && (!youtubeTitle(p) || youtubeTitle(p).length > 100)) throw new Error(`Titre YouTube invalide: ${p.id}`);
  }
}
export function inputFor(post, platform, env) {
  const channelId = env[`BUFFER_${platform.toUpperCase()}_CHANNEL_ID`];
  if (!channelId) throw new Error(`Channel ID manquant: ${platform}`);
  const base = env.R2_PUBLIC_BASE_URL;
  if (!post.url && !base) throw new Error('R2_PUBLIC_BASE_URL manquante');
  const url = post.url || `${base.replace(/\/$/, '')}/${post.file.split('/').map(encodeURIComponent).join('/')}`;
  if (new URL(url).protocol !== 'https:') throw new Error('La vidéo doit avoir une URL HTTPS');
  const input = { channelId, text: platformText(post, platform), schedulingType: 'automatic', mode: 'addToQueue', needsApproval: false, assets: [{ video: { url } }] };
  if (platform === 'youtube') input.metadata = { youtube: { categoryId: '22', madeForKids: false, privacy: 'public', ...post.youtube, title: youtubeTitle(post), isAiGenerated: post.isAiGenerated === true } };
  if (platform === 'tiktok') input.metadata = { tiktok: { isAiGenerated: post.isAiGenerated === true } };
  if (platform === 'instagram') {
    input.metadata = { instagram: { type: 'reel', shouldShareToFeed: true, isAiGenerated: post.isAiGenerated === true } };
    // Buffer choisit la miniature des Reels à 1 seconde (offset en millisecondes).
    input.assets[0].video.metadata = { thumbnailOffset: 1000 };
  }
  return input;
}
export async function processSlot({ posts, state, slot, env, persist, send, checkMedia, dryRun = false, dueAt, mode }) {
  validate(posts);
  if (state.version !== 1 || !state.slots || !state.deliveries) throw new Error('État invalide');
  if (Object.values(state.deliveries).some(d => ['sending', 'uncertain'].includes(d.status))) throw new Error('Envoi incertain: vérifier Buffer puis corriger state.json (voir README)');
  const assigned = state.slots[slot];
  const post = assigned ? posts.find(p => p.id === assigned) : posts.find(p => p.enabled !== false && p.platforms.some(platform => !isFinalDelivery(state.deliveries[deliveryKey(p.id, platform)])));
  if (!post) { if (assigned) throw new Error('Le post du créneau a été retiré'); return []; }
  if (post.enabled === false) return [];
  const work = post.platforms.filter(platform => !isFinalDelivery(state.deliveries[deliveryKey(post.id, platform)])).map(platform => ({ platform, input: { ...inputFor(post, platform, env), ...(mode === 'shareNow' ? { mode: 'shareNow' } : dueAt ? { mode: 'customScheduled', dueAt } : {}) } }));
  if (!work.length || dryRun) return work;
  await checkMedia(work[0].input.assets[0].video.url);
  state.slots[slot] = post.id;
  const failures = [];
  for (const { platform, input } of work) {
    const key = deliveryKey(post.id, platform);
    state.deliveries[key] = { status: 'sending', channelId: input.channelId, updatedAt: new Date().toISOString() };
    await persist(state); // Journal durable AVANT l'appel: une interruption bloque les doublons.
    let result;
    try { result = await send(input); }
    catch { result = { status: 'uncertain', error: 'Vérifier Buffer avant de réessayer' }; }
    state.deliveries[key] = { ...state.deliveries[key], ...result, updatedAt: new Date().toISOString() };
    await persist(state);
    if (result.status === 'uncertain') throw new Error(`Envoi uncertain: ${post.id}/${platform}. Consulter state.json.`);
    if (result.status !== 'queued') failures.push(platform);
  }
  if (failures.length) throw new Error(`Envoi rejected: ${post.id}/${failures.join(', ')}. Les autres réseaux ont été traités; consulter state.json.`);
  return work;
}
