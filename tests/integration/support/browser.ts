/**
 * A stand-in for one browser talking to the app: `next/headers` reads its cookies and address,
 * and cookies the server sets (sign-in, notices) land back in its jar. Test files mock
 * `next/headers` with `nextHeaders` and switch browsers with `switchBrowser()`.
 */

export interface Browser {
  ip: string;
  userAgent: string;
  jar: Map<string, string>;
}

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

export function newBrowser(userAgent = IPHONE_SAFARI): Browser {
  return {
    ip: `198.51.100.${Math.floor(Math.random() * 250) + 1}-${crypto.randomUUID().slice(0, 8)}`,
    userAgent,
    jar: new Map(),
  };
}

let current: Browser = newBrowser();

export const switchBrowser = (browser: Browser) => {
  current = browser;
  return browser;
};

export const currentBrowser = () => current;

/** Runs `work` as `browser`, so cookies the server sets land in its jar, then switches back. */
export async function asBrowser<T>(browser: Browser, work: () => Promise<T>): Promise<T> {
  const previous = current;
  current = browser;
  try {
    return await work();
  } finally {
    current = previous;
  }
}

export function cookieHeader(browser: Browser = current) {
  return [...browser.jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

/** Stores the cookies from a response's Set-Cookie headers, as a browser would. */
export function storeCookies(response: Response | Headers, browser: Browser = current) {
  const headers = response instanceof Response ? response.headers : response;
  for (const line of headers.getSetCookie()) {
    const [pair = '', ...attributes] = line.split(';');
    const index = pair.indexOf('=');
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    const expired = attributes.some(
      (attribute) =>
        /^\s*max-age=0\s*$/i.test(attribute) || /^\s*expires=thu, 01 jan 1970/i.test(attribute),
    );
    if (expired || value === '') browser.jar.delete(name);
    else browser.jar.set(name, value);
  }
}

export function requestHeaders(browser: Browser = current) {
  const headers = new Headers({ 'x-forwarded-for': browser.ip, 'user-agent': browser.userAgent });
  const cookie = cookieHeader(browser);
  if (cookie) headers.set('cookie', cookie);
  return headers;
}

const cookieStore = () => ({
  get: (name: string) =>
    current.jar.has(name) ? { name, value: current.jar.get(name)! } : undefined,
  getAll: () => [...current.jar].map(([name, value]) => ({ name, value })),
  has: (name: string) => current.jar.has(name),
  set: (name: string, value: string, options?: { maxAge?: number }) => {
    if (options?.maxAge === 0 || value === '') current.jar.delete(name);
    else current.jar.set(name, value);
  },
  delete: (name: string) => {
    current.jar.delete(name);
  },
});

/** The module to hand to `vi.mock('next/headers', ...)`. */
export const nextHeaders = {
  headers: async () => requestHeaders(),
  cookies: async () => cookieStore(),
};
