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
      ... on PostActionSuccess { post { id } }
      ... on MutationError { message }
    }
  }`, { input }, env, fetcher);
  const result = data.createPost;
  if (result?.post?.id) return { status: 'queued', bufferId: result.post.id };
  if (typeof result?.message === 'string') return { status: 'rejected', error: result.message };
  throw new Error('Résultat inconnu; vérifier Buffer avant toute nouvelle tentative');
}
