import { graphql } from './buffer.js';
try {
  if (!process.env.BUFFER_ORGANIZATION_ID) throw new Error('BUFFER_ORGANIZATION_ID manquante');
  const data = await graphql(`query GetChannels($input: ChannelsInput!) { channels(input: $input) { id name service isQueuePaused } }`, { input: { organizationId: process.env.BUFFER_ORGANIZATION_ID } });
  console.table(data.channels);
} catch (error) { console.error(error.message); process.exitCode = 1; }
