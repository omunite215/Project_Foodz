import { STAR_WORDS, type Stars } from '@/server/modules/ratings/schema';

/*
 * F9's rating words for the order page, the Orders list and staff screens (design 2, 3.10,
 * 3.16): pure functions, so the server render and the browser read the same text.
 */

/** "1 star" / "3 stars". */
export const starsCount = (stars: number) => `${stars} ${stars === 1 ? 'star' : 'stars'}`;

/** "1 star, Bad" … "5 stars, Great": a star radio's name and a summary's spoken text. */
export function starsLabel(stars: number): string {
  const word = STAR_WORDS[stars as Stars] as string | undefined;
  return word ? `${starsCount(stars)}, ${word}` : starsCount(stars);
}
