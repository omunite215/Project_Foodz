/*
 * The result of saving an address, carried from the form to the list it returns to ("Address
 * saved", focus on that card). It lives in memory for this tab only, so a reload never repeats it.
 */

export interface AddressStatus {
  text: string;
  /** The card to focus. */
  focusId: string | null;
}

let pending: AddressStatus | null = null;

export function setAddressStatus(status: AddressStatus): void {
  pending = status;
}

export function takeAddressStatus(): AddressStatus | null {
  const status = pending;
  pending = null;
  return status;
}

/** The status waiting for the list, without taking it. */
export function peekAddressStatus(): AddressStatus | null {
  return pending;
}
