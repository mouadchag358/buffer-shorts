import { createHash } from 'node:crypto';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { videoTitle } from './core.js';
export function postsFromKeys(keys) {
  return [...new Set(keys)].filter(k => /\.mp4$/i.test(k)).sort().map(file => ({
    id: 'r2-' + createHash('sha256').update(file).digest('hex'), enabled: true, file,
    title: videoTitle({ file }), text: '', platforms: ['tiktok', 'youtube', 'instagram'],
    youtube: { categoryId: '22', madeForKids: false, privacy: 'public' }, isAiGenerated: false
  }));
}
export function defaultList(env) {
  for (const key of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) if (!env[key]) throw new Error(`${key} manquante pour lister les vidéos R2`);
  if (!/^[a-f0-9]{32}$/i.test(env.R2_ACCOUNT_ID)) throw new Error('R2_ACCOUNT_ID invalide');
  const client = new S3Client({ region: 'auto', endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY }, maxAttempts: 1, followRegionRedirects: false });
  return async () => {
    try {
      return await client.send(new ListObjectsV2Command({ Bucket: env.R2_BUCKET_NAME || 'reels', Prefix: env.R2_PREFIX || '', MaxKeys: 1000 }), { abortSignal: AbortSignal.timeout(30000) });
    } finally { client.destroy(); }
  };
}
export async function loadCatalog({ state, persist, env = process.env, now = Date.now(), list }) {
  const day = new Date(now).toISOString().slice(0, 10);
  if (state.catalog?.day === day && Array.isArray(state.catalog.posts)) return state.catalog.posts;
  const prior = state.r2ListingRequests;
  if (prior && (!Number.isSafeInteger(prior.count) || prior.count < 0 || !Number.isFinite(prior.lastAt) || !Number.isFinite(prior.pauseUntil))) throw new Error('Compteur de listing R2 invalide');
  if (prior?.pauseUntil > now) throw new Error('Listing R2 en pause');
  if (prior && now - prior.lastAt < 10000) throw new Error('Listing R2 trop rapproché');
  const count = prior?.day === day ? prior.count : 0;
  if (count >= 2) throw new Error('Limite atteinte: 2 tentatives de listing R2 par jour UTC');
  const request = list || defaultList(env); // Valider les credentials avant de consommer un appel.
  state.r2ListingRequests = { day, count: count + 1, lastAt: now, pauseUntil: prior?.pauseUntil || 0 };
  await persist(state);
  let response;
  try { response = await request(); }
  catch (error) {
    if (error.$metadata?.httpStatusCode === 429) {
      state.r2ListingRequests.pauseUntil = now + 3600000; await persist(state);
    }
    throw new Error('Listing R2 échoué; aucune relance automatique. Vérifier accès R2 en lecture.');
  }
  if (response.IsTruncated) throw new Error('Plus de 1000 objets: définir R2_PREFIX pour réduire la liste. Pagination automatique désactivée.');
  if (!Array.isArray(response.Contents) && response.KeyCount !== 0) throw new Error('Réponse R2 inattendue');
  const posts = postsFromKeys((response.Contents || []).map(o => o.Key).filter(k => typeof k === 'string'));
  state.catalog = { day, posts }; await persist(state);
  return posts;
}
