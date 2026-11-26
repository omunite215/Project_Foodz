import { describe, expect, it } from 'vitest';
import { channels, parseChannel } from './channels';

const ID = '0196a1b2-0000-7000-8000-000000000001';

describe('the F8 channels', () => {
  const id = '018f0000-0000-7000-8000-000000001042';
  it('names and parses the tracking and map channels, and nothing near them', () => {
    expect(parseChannel(channels.track(id))).toEqual({ kind: 'track', id });
    expect(parseChannel(channels.opsMap)).toEqual({ kind: 'opsMap' });
    expect(parseChannel(channels.opsMapDemo)).toEqual({ kind: 'opsMapDemo' });
    expect(parseChannel('private-ops-map-real')).toBeNull();
    expect(parseChannel(`private-track-${id}x`)).toBeNull();
  });
});

describe('parseChannel', () => {
  it('recognises every channel the app publishes on', () => {
    expect(parseChannel(channels.order(ID))).toEqual({ kind: 'order', id: ID });
    expect(parseChannel(channels.user(ID))).toEqual({ kind: 'user', id: ID });
    expect(parseChannel(channels.partner(ID))).toEqual({ kind: 'partner', id: ID });
    expect(parseChannel(channels.ops)).toEqual({ kind: 'ops' });
    expect(parseChannel(channels.opsDemo)).toEqual({ kind: 'opsDemo' });
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
