export async function graphql(query, variables, env = process.env, fetcher = fetch) {
  if (!env.BUFFER_API_KEY) throw new Error('BUFFER_API_KEY manquante');
  const response = await fetcher('https://api.buffer.com', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.BUFFER_API_KEY}` },
    body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) throw new Error(`Buffer HTTP ${response.status}; résultat à vérifier`);
  const body = await response.json();
  if (body.errors?.length) throw new Error('Erreur GraphQL; résultat à vérifier dans Buffer');
  if (!body.data) throw new Error('Réponse Buffer inattendue');
  return body.data;
}
export async function createPost(input, env, fetcher) {
  const data = await graphql(`mutation CreateVideo($input: CreatePostInput!) {
    createPost(input: $input) {
      __typename
      ... on PostActionSuccess { post { id status dueAt } }
      ... on MutationError { message }
    }
  }`, { input }, env, fetcher);
  const result = data.createPost;
  if (result?.post?.id) {
    const post = result.post;
    if (post.status && !['scheduled', 'sending', 'sent'].includes(post.status)) return { status: 'uncertain', bufferId: post.id, error: `Buffer a créé un post ${post.status}: vérifier avant de réessayer` };
    return { status: 'queued', bufferId: post.id, ...(post.status ? { bufferStatus: post.status, dueAt: post.dueAt } : {}) };
  }
  if (typeof result?.message === 'string') return { status: 'rejected', error: result.message };
  throw new Error('Résultat inconnu; vérifier Buffer avant toute nouvelle tentative');
}

export async function queuedPosts(organizationId, channelIds, env, request = graphql) {
  const data = await request(`query Queue($input: PostsInput!) {
    posts(first: 100, input: $input) {
      edges { node { id channelId status dueAt text assets { source } } }
      pageInfo { hasNextPage }
    }
  }`, { input: { organizationId, filter: { channelIds, status: ['scheduled', 'sending'] }, sort: [{ field: 'dueAt', direction: 'asc' }] } }, env);
  if (data.posts?.pageInfo?.hasNextPage) throw new Error('Plus de 100 posts Buffer: arrêt sans pagination');
  if (!Array.isArray(data.posts?.edges)) throw new Error('File Buffer illisible');
  return data.posts.edges.map(e => e.node);
}
export async function getPost(id, env, request = graphql) {
  const { post } = await request(`query Status($input: PostInput!) {
    post(input: $input) { id channelId status dueAt sentAt externalLink error { message } }
  }`, { input: { id } }, env);
  if (!post?.id) throw new Error('Post Buffer introuvable');
  return post;
}
export async function reschedulePost(id, dueAt, env, request = graphql, content = {}) {
  const data = await request(`mutation Reschedule($input: EditPostInput!) {
    editPost(input: $input) {
      ... on PostActionSuccess { post { id status dueAt } }
      ... on MutationError { message }
    }
  }`, { input: { ...content, id, dueAt, mode: 'customScheduled', schedulingType: 'automatic' } }, env);
  if (!data.editPost?.post?.id) throw new Error(data.editPost?.message || 'Modification Buffer incertaine');
  return data.editPost.post;
}
