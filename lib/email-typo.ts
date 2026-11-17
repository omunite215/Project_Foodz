/*
 * "Did you mean maya@gmail.com?" A mistyped domain is the most likely reason a confirmation
 * email never arrives. Only well-known mail providers are suggested, and only when the typed
 * domain is one edit away (a missing, extra, wrong or swapped letter).
 */

const COMMON_DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'icloud.com',
  'aol.com',
] as const;

/** Edits between two strings, counting a swap of neighbours as one (optimal string alignment). */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_row, i) =>
    Array.from({ length: cols }, (_column, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
      }
    }
  }
  return d[a.length]![b.length]!;
}

/** The corrected address, or null when the domain looks fine (or is not a common one). */
export function suggestEmail(email: string): string | null {
  const value = email.trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at < 1) return null;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (!domain || (COMMON_DOMAINS as readonly string[]).includes(domain)) return null;
  const match = COMMON_DOMAINS.find((known) => editDistance(domain, known) === 1);
  return match ? `${local}@${match}` : null;
}
