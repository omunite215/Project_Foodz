/*
 * Deployment settings, read from CDK context (`cdk deploy -c name=value`, or `context` in
 * cdk.json). Nothing here is a secret; secrets live in Secrets Manager (see the README).
 */

export type Realtime = 'soketi' | 'pusher';
export type Jobs = 'inngest' | 'inngest-cloud';

export interface FoodzConfig {
  /** Tag of the runtime image (and `<tag>-migrate` for the migration image) in ECR. */
  imageTag: string;
  /** Web tasks to run. 0 for the first deploy, before the database has been migrated. */
  webCount: number;
  /** Soketi on Fargate, or Pusher Channels (needs pusherAppId, pusherKey, pusherCluster). */
  realtime: Realtime;
  /** Inngest on Fargate, or Inngest Cloud. */
  jobs: Jobs;
  /** Public host name, when a custom domain is used. */
  domainName?: string;
  /** ACM certificate (in us-east-1) for domainName. */
  certificateArn?: string;
  emailFrom: string;
  /** Wire up the Stripe secrets (secret `foodz/stripe`). */
  stripe: boolean;
  pusherAppId: string;
  pusherKey: string;
  pusherCluster: string;
  /** Cloudflare Turnstile site key (public). */
  turnstileSiteKey: string;
  /** Stripe publishable key (public), when stripe is on. */
  stripePublishableKey?: string;
  /** Keep the database and buckets when the stack is deleted. */
  retainData: boolean;
}

type Lookup = (key: string) => unknown;

const text = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;
const flag = (value: unknown, fallback: boolean) =>
  value === undefined ? fallback : value === true || value === 'true';

function oneOf<T extends string>(
  name: string,
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value === undefined) return fallback;
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value))
    return value as T;
  throw new Error(`Context "${name}" must be one of: ${allowed.join(', ')}`);
}

export function readConfig(lookup: Lookup): FoodzConfig {
  const webCount = Number(lookup('webCount') ?? 1);
  if (!Number.isInteger(webCount) || webCount < 0 || webCount > 10) {
    throw new Error('Context "webCount" must be a whole number from 0 to 10');
  }
  const imageTag = text(lookup('imageTag')) ?? 'latest';
  if (!/^[\w][\w.-]{0,127}$/.test(imageTag))
    throw new Error('Context "imageTag" is not a valid image tag');

  const domainName = text(lookup('domainName'));
  const certificateArn = text(lookup('certificateArn'));
  if (Boolean(domainName) !== Boolean(certificateArn)) {
    throw new Error('Context "domainName" and "certificateArn" must be set together');
  }
  if (
    certificateArn &&
    !/^arn:aws[\w-]*:acm:us-east-1:\d{12}:certificate\/.+/.test(certificateArn)
  ) {
    throw new Error(
      'Context "certificateArn" must be an ACM certificate in us-east-1 (CloudFront requires it)',
    );
  }

  const realtime = oneOf('realtime', lookup('realtime'), ['soketi', 'pusher'], 'soketi');
  const pusherAppId = text(lookup('pusherAppId')) ?? 'foodz';
  const pusherKey = text(lookup('pusherKey')) ?? '';
  const pusherCluster = text(lookup('pusherCluster')) ?? 'mt1';
  if (realtime === 'pusher' && (!text(lookup('pusherAppId')) || !pusherKey)) {
    throw new Error(
      'realtime=pusher needs the context values "pusherAppId", "pusherKey" and "pusherCluster"',
    );
  }
  if (realtime === 'soketi' && !pusherKey) {
    throw new Error('Context "pusherKey" is required (the public key browsers use to connect)');
  }

  const turnstileSiteKey = text(lookup('turnstileSiteKey'));
  if (!turnstileSiteKey)
    throw new Error('Context "turnstileSiteKey" is required (the public Turnstile key)');
  const stripe = flag(lookup('stripe'), false);
  const stripePublishableKey = text(lookup('stripePublishableKey'));
  if (stripe && !stripePublishableKey) {
    throw new Error('stripe=true needs the context value "stripePublishableKey"');
  }

  return {
    imageTag,
    webCount,
    realtime,
    jobs: oneOf('jobs', lookup('jobs'), ['inngest', 'inngest-cloud'], 'inngest'),
    domainName,
    certificateArn,
    emailFrom: text(lookup('emailFrom')) ?? `Foodz <no-reply@${domainName ?? 'example.com'}>`,
    stripe,
    stripePublishableKey,
    turnstileSiteKey,
    pusherAppId,
    pusherKey,
    pusherCluster,
    retainData: flag(lookup('retainData'), true),
  };
}
