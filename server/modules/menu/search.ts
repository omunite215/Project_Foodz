import { SEARCH_MAX_LENGTH } from './schema';

/*
 * Turning what was typed into search input (F3 S6). Pure, so it is unit tested on its own.
 *
 * The whole query goes to websearch_to_tsquery, which accepts any text and never errors. The
 * last word is also tried as the beginning of a word ("bul" finds "Bulgogi", "pad th" finds
 * "Pad Thai"); that word is letters and digits only, so the prefix query built from it cannot
 * carry any query syntax.
 */

export interface SearchTerms {
  /** The query as searched: control characters removed, spaces collapsed, at most 100 characters. */
  query: string;
  /** Everything before the last word, for the prefix variant. */
  head: string;
  /** The last word as a prefix term ("bul:*"), or null when the query doesn't end in a plain word. */
  prefix: string | null;
  /** Letters and digits in the query: suggestions need at least 3. */
  letters: number;
}

const INVISIBLE = /[\p{Cc}\p{Cf}]+/gu;
const PLAIN_WORD = /^[\p{L}\p{M}\p{N}]+$/u;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/gu;

export function searchTerms(raw: string): SearchTerms {
  const collapsed = raw.normalize('NFC').replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
  const query = Array.from(collapsed).slice(0, SEARCH_MAX_LENGTH).join('').trim();

  const words = query ? query.split(' ') : [];
  const last = words.at(-1) ?? '';
  // Inside an open quote the user is typing a phrase; "or" is websearch syntax.
  const openQuote = (query.match(/"/g)?.length ?? 0) % 2 === 1;
  const usable = PLAIN_WORD.test(last) && !openQuote && last.toLowerCase() !== 'or';

  return {
    query,
    head: usable ? words.slice(0, -1).join(' ') : '',
    prefix: usable ? `${last}:*` : null,
    letters: query.match(LETTER_OR_DIGIT)?.length ?? 0,
  };
}
