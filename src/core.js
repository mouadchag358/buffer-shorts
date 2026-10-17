const platforms = ['tiktok', 'youtube', 'facebook', 'instagram'];
export const isFinalDelivery = d => ['queued', 'published', 'failed_in_buffer', 'missing_in_buffer'].includes(d?.status) || (d?.status === 'rejected' && /Video must be vertical.*YouTube Shorts/i.test(d.error || ''));
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

const YOUTUBE_HOOK_TITLES = [
  "Did You Catch That Detail? 👀 #Shorts",
  "Watch Twice — Something Changes! 🔥 #Shorts",
  "What Would You Do Here? 😳 #Shorts",
  "The Ending Is Worth Watching 🎬 #Shorts",
  "Can You Guess What Happens Next? 🤯 #Shorts",
  "One Moment, So Many Questions 👀 #Shorts",
  "Don't Blink During This Part ⚡ #Shorts",
  "Would You Replay This? 👇 #Shorts",
  "Did You Expect That? 😲 #Shorts",
  "Look Closely at This Moment 🔥 #Shorts",
  "What's the Most Surprising Part? 👀 #Shorts",
  "This Clip Gets Better on Replay 🎬 #Shorts"
];
const YOUTUBE_HOOK_DESCRIPTIONS = [
  "👀 Did you catch that? Watch and tell us what you think!\n#Shorts #YouTubeShorts #Viral #Trending",
  "🔥 Worth another watch? Share your reaction below!\n#Shorts #YouTubeShorts #Trending #ViralVideo",
  "😮 What was your first reaction? Leave a comment!\n#Shorts #Viral #YouTubeShorts #TrendingNow",
  "👀 Watch closely and tell us what stood out!\n#Shorts #Trending #YouTubeShorts #MustWatch",
  "💬 Would you watch this again? Tell us why!\n#Shorts #Viral #YouTubeShorts #WatchAgain",
  "⭐ Rate this clip from 1 to 10 in the comments!\n#Shorts #YouTubeShorts #Viral #Trending",
  "😲 We want to hear your reaction! Comment below.\n#Shorts #Trending #YouTubeShorts #Viral",
  "🤯 What's your take on this clip? Let us know!\n#Shorts #YouTubeShorts #ViralVideo #Trending",
  "👇 Which part caught your attention? Tell us!\n#Shorts #YouTubeShorts #Trending #Viral",
  "🔥 What did you think of this moment? Comment!\n#Shorts #Viral #YouTubeShorts #TrendingNow",
  "😮 How would you react? Join the conversation!\n#Shorts #Trending #YouTubeShorts #Viral",
  "👀 Did you notice something interesting? Share below!\n#Shorts #YouTubeShorts #Viral #Trending"
];

const FACEBOOK_CAPTIONS = [
  "👀 Look closely. What detail stood out to you?\n#FacebookReels #Reels #WatchAgain",
  "🔥 The part everyone should watch twice. What do you think?\n#FacebookReels #Reels #WatchThis",
  "😮 Did you see that coming? Tell us your reaction.\n#FacebookReels #Unexpected #Reels",
  "🎬 Watch until the end, then tell us your favorite moment.\n#FacebookReels #ShortVideos #Reels",
  "⚡ One small detail makes this clip worth a replay.\n#FacebookReels #Reels #WatchClosely",
  "🤯 First impression or second watch — did your opinion change?\n#FacebookReels #Reels #WatchAgain",
  "👀 Which second made you stop scrolling?\n#FacebookReels #ShortClips #Reels",
  "🔥 This moment deserves another look. Your thoughts?\n#FacebookReels #Reels #Trending",
  "😲 Be honest: what was your first reaction?\n#FacebookReels #Reels #Unexpected",
  "🎥 Which part is your favorite? Drop a timestamp.\n#FacebookReels #Reels #ShortVideos"
];

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
  if (platform === 'facebook') return FACEBOOK_CAPTIONS[stableIndex(post.id || post.file || post.url, FACEBOOK_CAPTIONS.length)];
  if (platform === 'youtube') return YOUTUBE_HOOK_DESCRIPTIONS[stableIndex(post.id || post.file || post.url, YOUTUBE_HOOK_DESCRIPTIONS.length)];
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
  // Respect the specifically configured YouTube title; the R2 catalogue's
  // generic post.title is auto-derived from filenames and is not a custom title.
  const custom = post.youtube?.title;
  if (custom !== undefined) {
    if (typeof custom !== 'string') throw new Error(`Titre YouTube invalide: ${post.id}`);
    if (custom.trim()) return [...custom.trim()].reduce((acc, char) => acc.length + char.length <= 100 ? acc + char : acc, '').trim();
  }
  return YOUTUBE_HOOK_TITLES[stableIndex(post.id || post.file || post.url, YOUTUBE_HOOK_TITLES.length)];
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
  if (platform === 'facebook') input.metadata = { facebook: { type: 'reel' } };
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
