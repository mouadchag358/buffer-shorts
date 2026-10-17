import { readFile } from 'node:fs/promises';
import { graphql, queuedPosts } from './buffer.js';
import { resolveQueueChannels } from './discovery.js';

const state = JSON.parse(await readFile('pop-culture/state.json','utf8'));
const cards = JSON.parse(await readFile('pop-culture/questions.json','utf8'));
const ids = new Set([
  ...Object.keys(state.replacements || {}),
  ...Object.values(state.newImages || {}).map(x => x.bufferId).filter(Boolean),
  ...Object.values(state.alternation?.edits || {}).map(x => x.postId).filter(Boolean)
]);
const captions = new Set(cards.map(x => x.caption?.trim()).filter(Boolean));
const isQuiz = post => {
  const assets = post.assets || [];
  // Never delete anything with an identified video.
  if (assets.some(a => /\.(mp4|mov|webm)(?:[?#]|$)/i.test(a.source || ''))) return false;
  const quizImage = assets.some(a => /(?:pop-culture\/cards\/quiz-|quiz-\d{3}\.(?:png|jpe?g|webp))/i.test(a.source || ''));
  return quizImage || (ids.has(post.id) && assets.length > 0) ||
    (captions.has((post.text || '').trim()) && assets.length > 0);
};
const { env, channels } = await resolveQueueChannels(['facebook']);
if (channels[0].isDisconnected || channels[0].isLocked) throw Error('Facebook disconnected or locked');
const queue = await queuedPosts(env.BUFFER_ORGANIZATION_ID,[channels[0].id],env);
const targets = queue.filter(p => p.channelId === channels[0].id && p.status === 'scheduled' && isQuiz(p));
console.log('Facebook scheduled: '+queue.length+', identifiable quizzes: '+targets.length+', videos preserved: '+(queue.length-targets.length));
for (const post of targets) {
  console.log('Deleting quiz '+post.id+' '+post.dueAt);
  const data = await graphql(`mutation DeleteQuiz($input:DeletePostInput!){deletePost(input:$input){... on DeletePostSuccess{id} ... on VoidMutationError{message}}}`,{input:{id:post.id}},env);
  if (data.deletePost?.id !== post.id) throw Error('Buffer deletion not confirmed for '+post.id+': '+(data.deletePost?.message || 'unknown'));
  console.log('Deleted quiz '+post.id);
}
console.log('Facebook quiz cleanup finished');
