/**
 * The request header the proxy sets to the path and query a page was asked for. Read only to
 * build a sign-in return path, which safeRedirectPath() cleans, so a forged value can do no harm.
 */
export const REQUEST_PATH_HEADER = 'x-foodz-path';
