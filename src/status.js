import { readFile } from 'node:fs/promises';
import { graphql } from './buffer.js';
const state = JSON.parse(await readFile('state.json', 'utf8'));
const deliveries = Object.entries(state.deliveries).filter(([, d]) => d.bufferId).slice(-10);
for (const [key, delivery] of deliveries) {
  const { post } = await graphql(`query Status($input: PostInput!) {
    post(input: $input) { id status dueAt sentAt externalLink schedulingType notificationStatus error { message supportUrl } channel { service isDisconnected isLocked isQueuePaused } }
  }`, { input: { id: delivery.bufferId } });
  console.log(JSON.stringify({ delivery: key, ...post }));
}

const uncertain = Object.entries(state.deliveries).filter(([, delivery]) => delivery.status === 'uncertain');
if (uncertain.length) {
  let posts;
  try { posts = JSON.parse(await readFile('posts.json', 'utf8')); }
  catch { posts = state.catalog?.posts || []; }
  const orgData = await graphql('query { account { organizations { id } } }');
  const organizations = orgData.account?.organizations || [];
  const organizationId = process.env.BUFFER_ORGANIZATION_ID || (organizations.length === 1 ? organizations[0].id : null);
  if (!organizationId) throw new Error('Impossible d’identifier une organisation Buffer pour vérifier les envois incertains');
  const base = (process.env.R2_PUBLIC_BASE_URL || 'https://pub-30699360814641ee9a2e9e457cd4cc78.r2.dev').replace(/\\/$/, '');
  for (const [key, delivery] of uncertain) {
    const [sourceId] = JSON.parse(key);
    const source = state.catalog?.posts?.find(post => post.id === sourceId) || posts.find(post => post.id === sourceId);
    if (!source?.file || !delivery.channelId) {
      console.log(JSON.stringify({ delivery: key, status: 'uncertain', bufferMatch: 'source-or-channel-missing' }));
      continue;
    }
    const expectedUrl = base + '/' + source.file.split('/').map(encodeURIComponent).join('/');
    const data = await graphql(`query Queue($input: PostsInput!) {
      posts(first: 100, input: $input) {
        edges { node { id channelId status dueAt assets { source } } }
        pageInfo { hasNextPage }
      }
    }`, { input: { organizationId, filter: { channelIds: [delivery.channelId], status: ['scheduled', 'sending'] } } });
    const rows = data.posts?.edges?.map(edge => edge.node) || [];
    const matches = rows.filter(post => post.assets?.some(asset => asset.source === expectedUrl));
    console.log(JSON.stringify({ delivery: key, status: 'uncertain', bufferMatch: matches.length ? 'found' : 'not-found-in-active-queue', matches: matches.map(post => ({ id: post.id, status: post.status, dueAt: post.dueAt })) }));
  }
}
