# Massive Update coming to this project

# Stay tuned

Will transform this project into a Full Stack Web App

- Contact Page

## Deploying to AWS

Nothing here is deployed and no AWS account is needed to work on the project. The repository is
ready for one: `infra/` is an AWS CDK app (TypeScript, its own `package.json` and lockfile), and
CI proves it builds with `cdk synth` and cdk-nag (AwsSolutions) with no credentials.

What it creates: a VPC (no NAT gateway), an ECS Fargate web service behind an ALB and CloudFront,
RDS PostgreSQL 17 with PostGIS, ElastiCache Valkey (TLS and AUTH), two S3 buckets (public media is
served through CloudFront at `/media`; the private bucket is reached by signed links), Secrets
Manager, CloudWatch Logs, an ECR repository, and a one-off ECS task for migrations. Soketi
(realtime) and Inngest (jobs) run on Fargate by default, or use Pusher Channels and Inngest Cloud
with `realtime=pusher` and `jobs=inngest-cloud`. The app reaches S3 through the task role, so no
storage keys exist on AWS.

### Prerequisites

- An AWS account, the AWS CLI, Node 24 and Docker.
- A Cloudflare Turnstile site (public key and secret).
- SES: a verified sending identity, out of the sandbox, and SMTP credentials for it.
- Optional: a domain and an ACM certificate for it in `us-east-1` (needed for TLS 1.2 minimum and
  a stable address; without them the site uses the `*.cloudfront.net` name).

### Bootstrap (once per account and region)

```
cd infra && npm ci
npx cdk bootstrap aws://<account>/<region>
```

### Secrets to create

The stack generates the random ones (auth secret, database role passwords, cache token, the
CloudFront-to-ALB header). Create these yourself before the first deploy:

| Secret name      | JSON keys                                                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `foodz/app`      | `SMTP_URL`, `FIELD_ENCRYPTION_KEY` (32 bytes, base64), `TURNSTILE_SECRET_KEY`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `DEMO_PASSWORD` |
| `foodz/stripe`   | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (only with `stripe=true`)                                                                    |
| `foodz/realtime` | `PUSHER_SECRET` (only with `realtime=pusher`)                                                                                             |
| `foodz/inngest`  | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` (only with `jobs=inngest-cloud`)                                                               |

`SMTP_URL` looks like `smtps://<user>:<password>@email-smtp.<region>.amazonaws.com:465`, with the
user and password URL-encoded. Create them with `aws secretsmanager create-secret --name foodz/app
--secret-string file://...`, and never commit the file.

### First deploy

The settings are CDK context values (`-c name=value`); `infra/lib/config.ts` lists them.
`turnstileSiteKey` and `pusherKey` are always required.

```
cd infra
export CDK_DEFAULT_ACCOUNT=<account> CDK_DEFAULT_REGION=<region>
AWS_REGION=<region> IMAGE_TAG=$(git rev-parse HEAD) TURNSTILE_SITE_KEY=... PUSHER_KEY=... \
  FIRST_DEPLOY=true bash deploy.sh
```

`FIRST_DEPLOY=true` creates the infrastructure with no web tasks, pushes the images, runs the
migration task, then starts the web tasks. Later deploys leave it out.

To deploy from GitHub instead: create an IAM role that trusts this repository through GitHub OIDC,
set the repository variables `AWS_DEPLOY_ROLE_ARN`, `AWS_REGION`, `TURNSTILE_SITE_KEY` and
`PUSHER_KEY` (and optionally `DOMAIN_NAME`, `CERTIFICATE_ARN`, `REALTIME`, `JOBS`, `PUSHER_APP_ID`,
`PUSHER_CLUSTER`, `EMAIL_FROM`, `STRIPE`, `STRIPE_PUBLISHABLE_KEY`, `SITE_URL`), then run the
"Deploy to AWS" workflow by hand. It never runs on a push, and does nothing while
`AWS_DEPLOY_ROLE_ARN` is unset. Point your DNS name at the `DistributionDomain` stack output.

`NEXT_PUBLIC_*` values are compiled into the browser bundle, so the image is built with the final
site address; the script reads it from the stack when no domain is set.

### Migrations

Each deploy builds a `<tag>-migrate` image and runs the `foodz-migrate` task (`prisma/bootstrap.ts`
creates the extensions and the three database roles as the RDS admin, then `prisma migrate deploy`,
then the seed). Web tasks roll over before it runs, so write migrations that the running version
can live with (expand, then contract). A failed migration fails the deploy; logs are in
`/foodz/migrate`.

### Rough monthly cost (us-east-1, on-demand, idle traffic)

| Item                                                                       | USD/month        |
| -------------------------------------------------------------------------- | ---------------- |
| Fargate: web (0.5 vCPU, 1 GB), Soketi and Inngest (0.25 vCPU, 0.5 GB each) | 35               |
| Application Load Balancer                                                  | 18               |
| RDS PostgreSQL t4g.micro, single AZ, 20 GB gp3, backups                    | 16               |
| ElastiCache Valkey cache.t4g.micro                                         | 12               |
| Public IPv4 addresses (4 tasks, 2 for the ALB)                             | 20               |
| Secrets Manager (about 20 secrets)                                         | 8                |
| CloudFront, S3, CloudWatch Logs, Cloud Map, ECR                            | 5 to 10          |
| Total                                                                      | about 115 to 120 |

Using Pusher Channels and Inngest Cloud removes two Fargate tasks and their addresses (about 25
less, plus their plans). There is no NAT gateway, WAF or VPC endpoint, which would add 32, 6 and
7 or more per month each. Estimates only; check the AWS pricing calculator.

### Known limits

The database URLs use TLS without verifying the RDS certificate chain (the CA bundle is not in the
image yet). Browser uploads straight to S3 need the bucket origin in the CSP `connect-src`, which
`server/security/csp.ts` does not include yet. Nothing has been deployed, so the Inngest start
flags and the CloudFront-to-ALB secret header are untested against a real account.
