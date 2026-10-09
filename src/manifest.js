import { readdir, writeFile, access } from 'node:fs/promises';
import { videoTitle } from './core.js';
const directory = process.argv[2];
if (!directory) throw new Error('Usage: npm run manifest -- /chemin/videos');
try { await access('posts.generated.json'); throw new Error('posts.generated.json existe déjà'); }
catch (e) { if (e.code !== 'ENOENT') throw e; }
const files = (await readdir(directory)).filter(f => f.toLowerCase().endsWith('.mp4')).sort();
await writeFile('posts.generated.json', JSON.stringify(files.map((file, i) => ({ id: `short${String(i + 1).padStart(3, '0')}`, enabled: false, file, title: videoTitle({ file }), text: `${videoTitle({ file })}\n#fyp #fy #viral #ai`, platforms: ['facebook', 'youtube', 'instagram'], youtube: { categoryId: '22', madeForKids: false, privacy: 'public' }, isAiGenerated: false })), null, 2) + '\n', { flag: 'wx' });
console.log(`${files.length} entrées créées dans posts.generated.json (désactivées, à relire).`);
