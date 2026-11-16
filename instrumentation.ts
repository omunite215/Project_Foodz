export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Fail fast on missing or malformed configuration.
    await import('./server/env');
  }
}
