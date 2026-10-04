import { graphql } from './buffer.js';
export async function discoverChannels(platforms, env = process.env, request = graphql) {
  const result = { ...env };
  const missing = platforms.filter(p => !env[`BUFFER_${p.toUpperCase()}_CHANNEL_ID`]);
  if (!missing.length) return result;
  let organizationId = env.BUFFER_ORGANIZATION_ID;
  if (!organizationId) {
    const data = await request('query { account { organizations { id } } }', {}, env);
    const orgs = data.account?.organizations;
    if (!Array.isArray(orgs) || orgs.length !== 1) throw new Error('Plusieurs organisations Buffer ou aucune : renseigner BUFFER_ORGANIZATION_ID');
    organizationId = orgs[0].id;
  }
  const data = await request('query Channels($input: ChannelsInput!) { channels(input: $input) { id service isQueuePaused } }', { input: { organizationId } }, env);
  for (const platform of missing) {
    const matches = (data.channels || []).filter(c => c.service.toLowerCase() === platform);
    if (matches.length !== 1) throw new Error(`Buffer ${platform}: ${matches.length} comptes trouvés; renseigner un ID pour choisir`);
    if (matches[0].isQueuePaused) throw new Error(`La chaîne Buffer ${platform} est en pause`);
    result[`BUFFER_${platform.toUpperCase()}_CHANNEL_ID`] = matches[0].id;
  }
  return result;
}

export async function resolveQueueChannels(platforms, env = process.env, request = graphql) {
  let organizationId = env.BUFFER_ORGANIZATION_ID;
  if (!organizationId) {
    const data = await request('query { account { organizations { id } } }', {}, env);
    if (data.account?.organizations?.length !== 1) throw new Error('Choisir BUFFER_ORGANIZATION_ID');
    organizationId = data.account.organizations[0].id;
  }
  const data = await request(`query Channels($input: ChannelsInput!) {
    channels(input: $input) { id service isQueuePaused isDisconnected isLocked }
  }`, { input: { organizationId } }, env);
  const result = { ...env, BUFFER_ORGANIZATION_ID: organizationId }, channels = [];
  for (const platform of platforms) {
    const configured = env[`BUFFER_${platform.toUpperCase()}_CHANNEL_ID`];
    const matches = (data.channels || []).filter(c => c.service.toLowerCase() === platform && (!configured || c.id === configured));
    if (matches.length !== 1) throw new Error(`Buffer ${platform}: ${matches.length} comptes trouvés; renseigner un ID pour choisir`);
    channels.push({ ...matches[0], service: platform });
    result[`BUFFER_${platform.toUpperCase()}_CHANNEL_ID`] = matches[0].id;
  }
  return { env: result, channels };
}
