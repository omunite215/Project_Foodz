/*
 * Map paint colors (F8 design 0). MapLibre's paint properties and the markers' inline styles
 * need color strings, so the values live here, mirroring the tokens in app/globals.css for each
 * theme. No new colors: every value is an existing token. Customer and staff maps are always
 * light; partner maps follow the theme.
 */

export interface MapPalette {
  /** Route line (5 px) and its casing (8 px). */
  route: string;
  routeCasing: string;
  /** Dashed stale route and stale markers. */
  stale: string;
  /** The courier marker's disc (customer and staff "Delivering"), its icon and ring. */
  courier: string;
  courierIcon: string;
  ring: string;
  /** The partner's own dot and its ring. */
  you: string;
  youRing: string;
  /** The customer's door pin, its house glyph and its outline. */
  door: string;
  doorGlyph: string;
  doorStroke: string;
  /** The kitchen pin and its outline. */
  kitchen: string;
  kitchenStroke: string;
  /** Label chips drawn over the map: own background and a 3:1 edge. */
  chipBackground: string;
  chipText: string;
  chipBorder: string;
  /** The selected marker's outer ring (staff). */
  selected: string;
}

export const MAP_PALETTES = {
  light: {
    route: '#02630a', // brand-deep
    routeCasing: '#ffffff',
    stale: '#777e90', // neutral-4 / input
    courier: '#02630a',
    courierIcon: '#ffffff',
    ring: '#ffffff',
    you: '#106aab', // map-you
    youRing: '#ffffff',
    door: '#141416', // neutral-1
    doorGlyph: '#ffffff',
    doorStroke: '#ffffff',
    kitchen: '#03850a', // brand-strong
    kitchenStroke: '#ffffff',
    chipBackground: '#ffffff',
    chipText: '#141416',
    chipBorder: '#777e90',
    selected: '#02630a',
  },
  dark: {
    route: '#04b90b', // primary (dark)
    routeCasing: '#0c0c0c',
    stale: '#777e90',
    courier: '#04b90b',
    courierIcon: '#141416',
    ring: '#e6e8ec',
    you: '#4c9be0', // map-you (dark)
    youRing: '#e6e8ec',
    door: '#e6e8ec', // foreground (dark)
    doorGlyph: '#141416',
    doorStroke: '#141416',
    kitchen: '#04b90b', // brand
    kitchenStroke: '#141416',
    chipBackground: '#23262f', // card (dark)
    chipText: '#fcfcfd', // strong (dark)
    chipBorder: '#777e90',
    selected: '#04b90b',
  },
} as const satisfies Record<'light' | 'dark', MapPalette>;

export type MapTheme = keyof typeof MAP_PALETTES;

/** The live map's courier states (design 0, D29): the disc fill against the land. */
export const STATE_FILLS = {
  free: '#03850a', // brand-strong
  offered: '#106aab', // tag-3
  toKitchen: '#3304b9', // tag-8
  atKitchen: '#3304b9',
  delivering: '#141416', // neutral-1
  noAnswer: '#9a6b00', // warning-strong
  problem: '#d12b4f', // destructive
  locked: '#d12b4f',
} as const;

/** Gray, for two minutes or more without a point. */
export const STALE_FILL = '#777e90';

export const MAP_STYLES: Record<MapTheme, string> = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};
