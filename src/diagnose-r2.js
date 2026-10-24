import { defaultList } from './catalog.js';

const base = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');
if (!base || !/^https:\/\//i.test(base)) throw new Error('R2_PUBLIC_BASE_URL absente ou invalide');

const list = await defaultList(process.env);
const result = await list();
const key = (result.Contents || []).map(x => x.Key).find(k => typeof k === 'string' && /\.mp4$/i.test(k));
if (!key) throw new Error('Aucune vidéo MP4 trouvée dans le bucket R2');

const url = base + '/' + key.split('/').map(encodeURIComponent).join('/');
console.log('Diagnostic R2: domaine=' + new URL(base).host + ', fichiers=' + (result.Contents || []).length + ', vidéo testée=' + key.split('/').pop().slice(0, 80));

for (const method of ['HEAD', 'GET']) {
  try {
    const response = await fetch(url, {
      method,
      headers: method === 'GET' ? { Range: 'bytes=0-1023' } : {},
      redirect: 'follow',
      signal: AbortSignal.timeout(30000)
    });
    const type = response.headers.get('content-type') || '(absent)';
    const length = response.headers.get('content-length') || '(inconnu)';
    console.log(method + ': HTTP ' + response.status + ', type=' + type + ', longueur=' + length + ', final=' + new URL(response.url).host);
    if (method === 'GET') await response.body?.cancel();
  } catch (error) {
    console.log(method + ': ERREUR ' + String(error.message || error).slice(0, 250));
  }
}
