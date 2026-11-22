// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  afterAddressCheck,
  deliveryTarget,
  readCheckedAddress,
  setCheckedAddress,
} from './checked-address';

/*
 * An address checked in the cart without saving it (U2). Whatever the check says, the address
 * she checked last is the one the cart uses: an address outside the area must replace an earlier
 * one inside it, in the quote, in this tab's storage and after a reload (S2.8, D1).
 */

const FANEUIL = { line1: '1 Faneuil Hall Square', lat: 42.3600335, lng: -71.0562341 };
const QUINCY = { line1: '1300 Hancock Street', lat: 42.2513, lng: -71.0026 };

afterEach(() => {
  sessionStorage.clear();
});

describe('after an address check (S2.8)', () => {
  it('keeps an address outside the area too, and leaves "Choose another address" open', () => {
    expect(afterAddressCheck(QUINCY, false)).toEqual({ keep: QUINCY, closeCheck: false });
  });

  it('keeps an address inside the area and closes the check', () => {
    expect(afterAddressCheck(FANEUIL, true)).toEqual({ keep: FANEUIL, closeCheck: true });
  });

  it('replaces the earlier address in storage, so a reload brings back the outside one', () => {
    setCheckedAddress(afterAddressCheck(FANEUIL, true).keep);
    setCheckedAddress(afterAddressCheck(QUINCY, false).keep);
    expect(readCheckedAddress()).toEqual(QUINCY);
    expect(JSON.parse(sessionStorage.getItem('foodz.cart.point') ?? 'null')).toEqual(QUINCY);
  });

  it('quotes the outside point, so the breakdown and checkout follow it', () => {
    setCheckedAddress(FANEUIL);
    setCheckedAddress(QUINCY);
    expect(
      deliveryTarget({ checked: readCheckedAddress(), signedIn: false, addressId: null }),
    ).toEqual({ kind: 'point', lat: QUINCY.lat, lng: QUINCY.lng });
  });

  it('ignores a tampered record', () => {
    sessionStorage.setItem('foodz.cart.point', JSON.stringify({ line1: '', lat: 999, lng: 0 }));
    expect(readCheckedAddress()).toBeNull();
  });
});

describe('where the quote delivers to (design 2.15, D18)', () => {
  it('uses the checked address when it counts', () => {
    expect(deliveryTarget({ checked: FANEUIL, signedIn: true, addressId: 'a' })).toEqual({
      kind: 'point',
      lat: FANEUIL.lat,
      lng: FANEUIL.lng,
    });
  });

  it('otherwise the chosen saved address, the default one, or none for a guest', () => {
    const id = '0196a1b2-0000-7000-8000-0000000000aa';
    expect(deliveryTarget({ checked: null, signedIn: true, addressId: id })).toEqual({
      kind: 'saved',
      addressId: id,
    });
    expect(deliveryTarget({ checked: null, signedIn: true, addressId: null })).toEqual({
      kind: 'default',
    });
    expect(deliveryTarget({ checked: null, signedIn: false, addressId: id })).toEqual({
      kind: 'none',
    });
  });
});
