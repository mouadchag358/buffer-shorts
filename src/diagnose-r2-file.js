import { createWriteStream } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { defaultList } from './catalog.js';

export function publicVideoUrl(base, key) {
  if (typeof key !== 'string' || !key || key.startsWith('/')) throw new Error('Clé R2 invalide');
  const root = new URL(base);
  if (root.protocol !== 'https:') throw new Error('R2_PUBLIC_BASE_URL doit utiliser HTTPS');
  return root.href.replace(/\\/$/, '') + '/' + key.split('/').map(encodeURIComponent).join('/');
}

async function main() {
  const request = JSON.parse(await readFile('.github/requests/diagnose-r2.json', 'utf8'));
  const key = request.key;
  const base = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\\/$/, '');
  if (!base || !key) throw new Error('R2_PUBLIC_BASE_URL ou clé diagnostique manquante');

  const listing = await defaultList(process.env)();
  if (!(listing.Contents || []).some(item => item.Key === key)) throw new Error('La clé demandée est introuvable dans le listing R2');
  const url = publicVideoUrl(base, key);
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(120000) });
  console.log(JSON.stringify({
    status: response.status,
    contentType: response.headers.get('content-type'),
    contentLength: response.headers.get('content-length'),
    urlHost: new URL(response.url).host
  }));
  if (!response.ok || !response.body) throw new Error('Téléchargement public R2 impossible');

  const path = join(tmpdir(), 'r2-diagnostic-' + randomUUID() + '.mp4');
  let bytes = 0;
  const limit = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > 512 * 1024 * 1024 ? new Error('Fichier supérieur à la limite diagnostique de 512 Mo') : null, chunk);
    }
  });
  try {
    await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(path, { flags: 'wx' }));
    console.log('Taille téléchargée: ' + bytes);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries',
      'format=format_name,duration,size:stream=codec_type,codec_name,profile,width,height,pix_fmt,avg_frame_rate,sample_rate,channels',
      '-of', 'json', path], { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
    console.log('ffprobe exit=' + probe.status + '\\n' + (probe.stdout || '').slice(0, 4000) + (probe.stderr || '').slice(0, 1000));
    if (probe.status !== 0) throw new Error('ffprobe ne peut pas lire le fichier');

    const decode = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'null', '-'],
      { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
    console.log('Décodage complet ffmpeg exit=' + decode.status + (decode.stderr ? '\\n' + decode.stderr.slice(0, 2000) : ''));
    if (decode.status !== 0) throw new Error('Le décodage complet FFmpeg a échoué');
  } finally {
    await unlink(path).catch(() => {});
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === new URL('file://' + process.argv[1]).pathname) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
