import { describe, expect, it } from 'vitest';
import { offlineNotice } from './text';

describe('the offline notices (F6 design 6.6, F7 P25.2)', () => {
  it('explains the missed-offers offline step', () => {
    expect(offlineNotice('missed-offers', '2026-11-21T00:42:00Z', 'America/New_York')).toEqual({
      words:
        "We took you offline because you missed 3 offers in a row. Go online when you're ready for orders.",
      ifDisconnected: null,
    });
  });

  it('keeps the two no-location sentences', () => {
    expect(offlineNotice('no-location', '2026-11-21T00:42:00Z', 'America/New_York')).toEqual({
      words: "You went offline at 7:42 pm because we hadn't had your location for 10 minutes.",
      ifDisconnected: 'You went offline at 7:42 pm because we lost your connection for 10 minutes.',
    });
  });
});
