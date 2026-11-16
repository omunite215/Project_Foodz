import { describe, expect, it } from 'vitest';
import { channels, parseChannel } from './channels';

const ID = '0196a1b2-0000-7000-8000-000000000001';

describe('parseChannel', () => {
  it('recognises every channel the app publishes on', () => {
    expect(parseChannel(channels.order(ID))).toEqual({ kind: 'order', id: ID });
    expect(parseChannel(channels.user(ID))).toEqual({ kind: 'user', id: ID });
    expect(parseChannel(channels.partner(ID))).toEqual({ kind: 'partner', id: ID });
    expect(parseChannel(channels.ops)).toEqual({ kind: 'ops' });
  });

  it.each([
    `public-order-${ID}`,
    `presence-order-${ID}`,
    `private-order-${ID.toUpperCase()}`,
    `private-order-${ID}-extra`,
    `private-order-${ID};private-ops`,
    `private-orders-${ID}`,
    'private-order-',
    'private-order-../../ops',
    'private-ops-extra',
    `private-encrypted-order-${ID}`,
    '',
  ])('rejects %j', (name) => {
    expect(parseChannel(name)).toBeNull();
  });
});
