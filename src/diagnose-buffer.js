// Diagnostic strictement en lecture seule de la connexion Buffer.
// Ne jamais afficher les jetons, les IDs de chaînes, les posts ou les URLs.
const apiKey = process.env.BUFFER_API_KEY;
if (!apiKey) throw new Error('BUFFER_API_KEY absent dans GitHub Actions');

const sanitize = raw => String(raw ?? 'Erreur inconnue')
  .replaceAll(apiKey, '[SECRET]')
  .replace(/Bearer\s+\S+/gi, 'Bearer [SECRET]')
  .replace(/\b[a-f\d]{24,}\b/gi, '[IDENTIFIANT]')
  .slice(0, 500);

async function readOnly(label, query, variables = {}) {
  const response = await fetch('https://api.buffer.com', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30000)
  });
  let data;
  try { data = await response.json(); } catch {
    throw new Error(label + ': HTTP ' + response.status + ', réponse non JSON');
  }
  if (!response.ok || data.errors?.length) {
    const errors = (data.errors || []).slice(0, 3)
      .map(e => sanitize(e.message) + (e.extensions?.code ? ' [code: ' + sanitize(e.extensions.code) + ']' : ''));
    throw new Error(label + ': HTTP ' + response.status + ' / ' + errors.join(' | '));
  }
  if (!data.data) throw new Error(label + ': résultat sans data');
  console.log(label + ': OK');
  return data.data;
}

try {
  const organizations = (await readOnly('ORGANISATIONS',
    'query DiagnoseOrgs { account { organizations { id } } }')).account?.organizations;
  if (!Array.isArray(organizations)) throw new Error('ORGANISATIONS: structure inattendue');
  console.log('Nombre organisations:', organizations.length);
  if (organizations.length !== 1 && !process.env.BUFFER_ORGANIZATION_ID) {
    throw new Error('Plusieurs organisations : définir BUFFER_ORGANIZATION_ID');
  }
  const orgId = process.env.BUFFER_ORGANIZATION_ID || organizations[0].id;
  const channels = (await readOnly('CHAINES',
    'query DiagnoseChannels($input: ChannelsInput!) { channels(input: $input) { id service isQueuePaused isDisconnected isLocked } }',
    { input: { organizationId: orgId } })).channels;
  if (!Array.isArray(channels)) throw new Error('CHAINES: structure inattendue');
  for (const service of ['facebook', 'instagram', 'youtube']) {
    const matches = channels.filter(c => String(c.service).toLowerCase() === service);
    console.log(service + ': ' + matches.length + ' chaîne(s)' + (matches.length === 1 ?
      ', pause=' + matches[0].isQueuePaused + ', déconnectée=' + matches[0].isDisconnected +
      ', bloquée=' + matches[0].isLocked : ''));
  }
  const ids = channels.filter(c => ['facebook','instagram','youtube'].includes(String(c.service).toLowerCase())).map(c=>c.id);
  if (ids.length) {
    await readOnly('LECTURE_FILE',
      'query DiagnosePosts($input: PostsInput!) { posts(first: 1, input: $input) { edges { node { id channelId status dueAt text assets { source } } } pageInfo { hasNextPage } } }',
      { input: { organizationId: orgId, filter: { channelIds: ids, status: ['scheduled', 'sending'] }, sort: [{ field: 'dueAt', direction: 'asc' }] } });
  }
  console.log('Diagnostic en lecture seule terminé : aucune publication créée.');
} catch (error) {
  console.error('DIAGNOSTIC ECHEC:', sanitize(error.message));
  process.exitCode = 1;
}
