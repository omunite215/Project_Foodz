import { describe, expect, it } from 'vitest';
import { networkOf, UNKNOWN_CLIENT } from './client-ip';

describe('the network a client address is counted as', () => {
  it('counts an IPv4 address as itself', () => {
    expect(networkOf('203.0.113.9')).toBe('203.0.113.9');
    expect(networkOf(UNKNOWN_CLIENT)).toBe(UNKNOWN_CLIENT);
  });

  it('counts every address in an IPv6 /64 as one network, however it is written', () => {
    const network = '2001:db8:85a3:42::/64';
    for (const address of [
      '2001:db8:85a3:42::1',
      '2001:0db8:85a3:0042:ffff:ffff:ffff:ffff',
      '2001:DB8:85A3:42:1234:5678:9abc:def0',
      '2001:db8:85a3:42::1%eth0',
    ]) {
      expect(networkOf(address)).toBe(network);
    }
    expect(networkOf('2001:db8:85a3:43::1')).not.toBe(network);
    expect(networkOf('::1')).toBe('0:0:0:0::/64');
  });

  it('counts an IPv4 address written in IPv6 form as IPv4', () => {
    expect(networkOf('::ffff:203.0.113.9')).toBe('203.0.113.9');
  });

  it('leaves anything that is not an address as it is', () => {
    expect(networkOf('1::2::3')).toBe('1::2::3');
    expect(networkOf('zz::1')).toBe('zz::1');
  });
});
