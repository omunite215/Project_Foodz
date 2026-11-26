import { describe, expect, it } from 'vitest';
import {
  clockLeft,
  CODE_RETRIES,
  codeRetry,
  earnedOf,
  endingNotice,
  farDescription,
  mapsName,
  mapsWarning,
  pickedUpName,
  problemLabel,
  problemNotice,
  routeFigure,
  secondsLeft,
  wrongCodeText,
} from './delivery-text';

const now = Date.parse('2026-11-21T00:42:00.000Z');
const inMinutes = (minutes: number) => new Date(now + minutes * 60_000).toISOString();

describe('partner delivery words (F8 design 2)', () => {
  it('words the map figure for each leg', () => {
    expect(routeFigure({ etaAt: inMinutes(3.4), distanceM: 1400 }, true, now)).toEqual({
      figure: '4 min',
      rest: ' to the kitchen',
      spoken: '4 minutes to the kitchen',
    });
    expect(routeFigure({ etaAt: inMinutes(1), distanceM: 1420 }, false, now)).toEqual({
      figure: '1 min',
      rest: ' · 1.4 km to go',
      spoken: '1 minute, 1.4 km to go',
    });
    expect(routeFigure(null, true, now)).toBeNull();
    // Review P2: within 50 m it says where he is, not "0.0 km to go".
    expect(routeFigure({ etaAt: inMinutes(1), distanceM: 1420 }, false, now, 30)).toEqual({
      figure: 'At the door',
      rest: '',
      spoken: 'At the door',
    });
  });

  it('starts the slider name with its visible words', () => {
    expect(pickedUpName('1042')).toBe('Slide when you have the food, picked up order 1042');
  });

  it('names the maps link and words the warning before and after pickup', () => {
    expect(mapsName(null)).toBe('Open in Maps, directions to Foodz Kitchen');
    expect(mapsName('Priya')).toBe("Open in Maps, directions to Priya's door");
    expect(mapsWarning(false)).toContain("Foodz can't see you coming");
    expect(mapsWarning(true)).toContain("the customer's map pauses");
    expect(farDescription('pickUp', 1240)).toBe("You're 1.2 km from the kitchen.");
    expect(farDescription('handOver', 1240)).toBe("You're 1.2 km from the drop-off.");
  });

  it('counts tries down to one', () => {
    expect(wrongCodeText('Priya', 4)).toBe(
      "That code doesn't match. Ask Priya to read it from the order page. 4 tries left.",
    );
    expect(wrongCodeText('Priya', 1)).toContain('1 try left.');
    expect(earnedOf('Order 1042 delivered · You earned $7.64', '$0.00')).toBe('$7.64');
    expect(earnedOf('something else', '$7.64')).toBe('$7.64');
  });

  it('labels problems and their notices with the first name', () => {
    expect(problemLabel('no-answer', 'Priya')).toBe("Priya isn't answering");
    expect(problemLabel('refused', 'Priya')).toBe('Priya refused the order');
    expect(problemNotice('address', 'Priya')).toEqual({
      text: 'Call Priya, or call Foodz Kitchen for help.',
      tone: 'warning',
      callCustomer: true,
    });
    expect(problemNotice('cant-finish', 'Priya').tone).toBe('error');
  });

  it('runs the waiting clock on the server time', () => {
    const since = new Date(now - 48_000).toISOString();
    expect(clockLeft(since, 300, now)).toBe('4:12 left');
    expect(clockLeft(new Date(now - 400_000).toISOString(), 300, now)).toBe('0:00');
    expect(secondsLeft(since, 300, now)).toBe(252);
  });

  it('words the staff endings without naming anyone', () => {
    expect(endingNotice('confirmed', '1042', '$7.64').text).toBe(
      'Foodz support confirmed order 1042 as delivered. You earned $7.64.',
    );
    expect(endingNotice('cancelledBringBack', '1042', null)).toEqual({
      text: 'Order 1042 was cancelled. Bring the food back to Foodz Kitchen.',
      tone: 'warning',
      bringBack: true,
    });
    // F9 P57.3: the fee he keeps, when his partner state has it.
    expect(endingNotice('cancelledBringBack', '1043', null, 264).text).toBe(
      "Order 1043 was cancelled. Bring the food back to Foodz Kitchen. You'll still get the $2.64 delivery fee.",
    );
    expect(endingNotice('markedDelivered', '1042', null).text).toBe(
      'Foodz marked order 1042 as delivered.',
    );
  });

  it('re-sends a code only when it never left the phone, and at most 5 times (gate S8)', () => {
    expect(CODE_RETRIES).toBe(5);
    expect(codeRetry('offline', 0)).toBe('retry');
    expect(codeRetry('offline', 4)).toBe('retry');
    expect(codeRetry('offline', 5)).toBe('stop');
    expect(codeRetry('unavailable', 0)).toBe('stop');
    expect(codeRetry('wrong', 0)).toBe('stop');
    expect(codeRetry('delivered', 0)).toBe('stop');
  });
});

describe('the waiting clock (P43.2)', () => {
  const since = '2026-11-26T04:00:00.000Z';
  it('never opens above the wait, whatever the clock offset', () => {
    const behind = Date.parse(since) - 3_000;
    expect(secondsLeft(since, 300, behind)).toBe(300);
    expect(clockLeft(since, 300, behind)).toBe('5:00 left');
    expect(clockLeft(since, 300, Date.parse(since) + 61_000)).toBe('3:59 left');
    expect(clockLeft(since, 300, Date.parse(since) + 400_000)).toBe('0:00');
  });
});
