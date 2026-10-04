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
