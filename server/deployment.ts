type Env = Record<string, string | undefined>;

/**
 * True on a real production deployment, where test-only switches must never apply: Vercel
 * production, or AWS (the CDK task definition sets FOODZ_DEPLOYMENT=production, and ECS
 * provides its task metadata URI). Local, CI and preview runs are not production here.
 */
export function isDeployedProduction(env: Env = process.env): boolean {
  return (
    env.VERCEL_ENV === 'production' ||
    env.FOODZ_DEPLOYMENT === 'production' ||
    Boolean(env.ECS_CONTAINER_METADATA_URI_V4)
  );
}
