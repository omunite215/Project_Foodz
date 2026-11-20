/** One value of a page's search parameter (the first, when it was given more than once). */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
