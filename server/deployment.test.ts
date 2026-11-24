import { describe, expect, it } from 'vitest';
import { isDeployedProduction } from './deployment';

describe('isDeployedProduction', () => {
  it('knows Vercel production and AWS', () => {
    expect(isDeployedProduction({ VERCEL_ENV: 'production' })).toBe(true);
    expect(isDeployedProduction({ FOODZ_DEPLOYMENT: 'production' })).toBe(true);
    expect(
      isDeployedProduction({ ECS_CONTAINER_METADATA_URI_V4: 'http://169.254.170.2/v4/x' }),
    ).toBe(true);
  });

  it('is false for local, CI and preview runs', () => {
    expect(isDeployedProduction({})).toBe(false);
    expect(isDeployedProduction({ NODE_ENV: 'production', CI: 'true' })).toBe(false);
    expect(isDeployedProduction({ VERCEL_ENV: 'preview' })).toBe(false);
    expect(isDeployedProduction({ FOODZ_DEPLOYMENT: 'staging' })).toBe(false);
  });
});
