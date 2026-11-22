import 'server-only';
import { z } from 'zod';
import { distanceMeters } from './map-geometry';

/*
 * Every call to an outside map service goes through this file. Hosts are fixed here (never taken
 * from a request), coordinates are checked numbers, and each call has a timeout. The public
 * servers have fair-use limits; callers rate-limit per user, and the hosts can be swapped for
 * self-hosted ones in one place.
 */

export const PHOTON_URL = 'https://photon.komoot.io/api/';

const SEARCH_TIMEOUT_MS = 4000;
const USER_AGENT = 'foodz-address-search/1.0';

/**
 * Suggestions come from around the kitchen only: Greater Boston, well past the delivery radius
 * so a place just outside it still gets its "we don't deliver there yet" answer (S4.6).
 */
export const SEARCH_RADIUS_KM = 40;
const KM_PER_DEGREE = 111.32;

/** The same address is often several map objects (building, entrance, street segments). */
const SAME_HOUSE_M = 300;
const SAME_STREET_M = 2000;

export const latitudeSchema = z.number().finite().min(-90).max(90);
export const longitudeSchema = z.number().finite().min(-180).max(180);
export const latLngSchema = z.object({ lat: latitudeSchema, lng: longitudeSchema }).strict();
export type LatLng = z.infer<typeof latLngSchema>;

/** The outside service failed or took too long. */
export class GeoUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Address search is unavailable', { cause });
    this.name = 'GeoUnavailableError';
  }
}

export interface PlaceSuggestion {
  /** Stable for one map object, e.g. "W8651552". */
  id: string;
  /** "12 Peterborough Street", or the street alone when there is no house number. */
  line1: string;
  /** "Boston, MA 02215". */
  city: string;
  /** A named place (a building, a park) when the result is one. */
  placeName: string | null;
  hasHouseNumber: boolean;
  lat: number;
  lng: number;
}

const US_STATES: Record<string, string> = {
  Alabama: 'AL',
  Alaska: 'AK',
  Arizona: 'AZ',
  Arkansas: 'AR',
  California: 'CA',
  Colorado: 'CO',
  Connecticut: 'CT',
  Delaware: 'DE',
  'District of Columbia': 'DC',
  Florida: 'FL',
  Georgia: 'GA',
  Hawaii: 'HI',
  Idaho: 'ID',
  Illinois: 'IL',
  Indiana: 'IN',
  Iowa: 'IA',
  Kansas: 'KS',
  Kentucky: 'KY',
  Louisiana: 'LA',
  Maine: 'ME',
  Maryland: 'MD',
  Massachusetts: 'MA',
  Michigan: 'MI',
  Minnesota: 'MN',
  Mississippi: 'MS',
  Missouri: 'MO',
  Montana: 'MT',
  Nebraska: 'NE',
  Nevada: 'NV',
  'New Hampshire': 'NH',
  'New Jersey': 'NJ',
  'New Mexico': 'NM',
  'New York': 'NY',
  'North Carolina': 'NC',
  'North Dakota': 'ND',
  Ohio: 'OH',
  Oklahoma: 'OK',
  Oregon: 'OR',
  Pennsylvania: 'PA',
  'Rhode Island': 'RI',
  'South Carolina': 'SC',
  'South Dakota': 'SD',
  Tennessee: 'TN',
  Texas: 'TX',
  Utah: 'UT',
  Vermont: 'VT',
  Virginia: 'VA',
  Washington: 'WA',
  'West Virginia': 'WV',
  Wisconsin: 'WI',
  Wyoming: 'WY',
  'Puerto Rico': 'PR',
};

const photonText = z.string().max(200).optional();
const photonFeature = z.object({
  geometry: z.object({ coordinates: z.tuple([longitudeSchema, latitudeSchema]) }),
  properties: z.object({
    osm_type: z.string().max(2).optional(),
    osm_id: z.number().int().optional(),
    countrycode: z.string().max(3).optional(),
    name: photonText,
    housenumber: photonText,
    street: photonText,
    city: photonText,
    town: photonText,
    village: photonText,
    district: photonText,
    state: photonText,
    postcode: photonText,
  }),
});
const photonResponse = z.object({ features: z.array(z.unknown()).max(50) });

/** "Boston, MA 02215" from the parts Photon returns. */
function cityLine(p: z.infer<typeof photonFeature>['properties']) {
  const place = p.city ?? p.town ?? p.village ?? p.district;
  const state = p.state ? (US_STATES[p.state] ?? p.state) : undefined;
  const region = [state, p.postcode].filter(Boolean).join(' ');
  return [place, region].filter(Boolean).join(', ');
}

const comparable = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/** Street line plus town, ignoring the state and ZIP that some map objects lack. */
const sameAddressKey = (line1: string, p: z.infer<typeof photonFeature>['properties']) =>
  `${comparable(line1)}|${comparable(p.city ?? p.town ?? p.village ?? p.district ?? '')}`;

export interface ParseOptions {
  /** The store: results further than SEARCH_RADIUS_KM from it are dropped. */
  near?: LatLng;
  limit?: number;
}

/**
 * Turns a Photon response into US suggestions near the store. Anything malformed is skipped, and
 * results for the same address close together are shown once, keeping the fuller city line.
 */
export function parsePhotonResponse(
  body: unknown,
  { near, limit = 5 }: ParseOptions = {},
): PlaceSuggestion[] {
  const parsed = photonResponse.safeParse(body);
  if (!parsed.success) return [];

  const kept: { key: string; suggestion: PlaceSuggestion }[] = [];
  const seen = new Set<string>();
  for (const raw of parsed.data.features) {
    const feature = photonFeature.safeParse(raw);
    if (!feature.success) continue;
    const { properties: p, geometry } = feature.data;
    if (p.countrycode?.toUpperCase() !== 'US') continue;

    const street = p.street ?? (p.housenumber ? undefined : p.name);
    if (!street) continue;
    const hasHouseNumber = Boolean(p.housenumber);
    const line1 = hasHouseNumber ? `${p.housenumber} ${street}` : street;
    const city = cityLine(p);
    if (!city) continue;

    const [lng, lat] = geometry.coordinates;
    if (near && distanceMeters(near, { lat, lng }) > SEARCH_RADIUS_KM * 1000) continue;

    const id =
      p.osm_type && p.osm_id !== undefined ? `${p.osm_type}${p.osm_id}` : `${line1}|${city}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const suggestion: PlaceSuggestion = {
      id,
      line1,
      city,
      placeName: p.street && p.name && p.name !== street ? p.name : null,
      hasHouseNumber,
      lat,
      lng,
    };
    const key = sameAddressKey(line1, p);
    const sameWithin = hasHouseNumber ? SAME_HOUSE_M : SAME_STREET_M;
    const twin = kept.find(
      (entry) =>
        entry.key === key &&
        entry.suggestion.hasHouseNumber === hasHouseNumber &&
        distanceMeters(entry.suggestion, suggestion) <= sameWithin,
    );
    if (twin) {
      if (suggestion.city.length > twin.suggestion.city.length) twin.suggestion = suggestion;
      continue;
    }
    if (kept.length >= limit) break;
    kept.push({ key, suggestion });
  }
  return kept.map((entry) => entry.suggestion);
}

/** Photon's `bbox` (west, south, east, north) around a point. */
function boundingBox({ lat, lng }: LatLng, km: number) {
  const dLat = km / KM_PER_DEGREE;
  const dLng = km / (KM_PER_DEGREE * Math.cos((lat * Math.PI) / 180));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat].map((n) => n.toFixed(4)).join(',');
}

/** The search URL: fixed host, query and numeric bias only. */
export function photonSearchUrl(query: string, near: LatLng) {
  const { lat, lng } = latLngSchema.parse(near);
  const url = new URL(PHOTON_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('lang', 'en');
  url.searchParams.set('limit', '15');
  url.searchParams.set('lat', lat.toFixed(5));
  url.searchParams.set('lon', lng.toFixed(5));
  url.searchParams.set('bbox', boundingBox({ lat, lng }, SEARCH_RADIUS_KM));
  url.searchParams.append('layer', 'house');
  url.searchParams.append('layer', 'street');
  return url;
}

/**
 * Address suggestions for a typed query, US only, within SEARCH_RADIUS_KM of `near` and biased
 * towards it. Throws GeoUnavailableError when the service fails or takes longer than 4 seconds.
 */
export async function searchPlaces(
  query: string,
  near: LatLng,
  fetchImpl: typeof fetch = fetch,
): Promise<PlaceSuggestion[]> {
  const url = photonSearchUrl(query, near);
  let body: unknown;
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      redirect: 'error',
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Photon answered ${response.status}`);
    body = await response.json();
  } catch (error) {
    throw new GeoUnavailableError(error);
  }
  return parsePhotonResponse(body, { near });
}
