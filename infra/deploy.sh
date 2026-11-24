#!/usr/bin/env bash
# Deploys Foodz to the AWS account the current credentials belong to. Run by the "Deploy to AWS"
# workflow, and usable by hand after `aws sso login` or similar. Nothing here prints a secret.
#
#   FIRST_DEPLOY=true   create the infrastructure with no web tasks, migrate, then start them
#   (default)           push the new images, update the stack, then migrate
#
# Settings come from the environment (the workflow maps repository variables onto them):
#   AWS_REGION, IMAGE_TAG                     required
#   TURNSTILE_SITE_KEY, PUSHER_KEY            required (public values)
#   DOMAIN_NAME, CERTIFICATE_ARN              optional custom domain
#   REALTIME (soketi|pusher), JOBS (inngest|inngest-cloud), PUSHER_APP_ID, PUSHER_CLUSTER,
#   EMAIL_FROM, STRIPE (true|false), STRIPE_PUBLISHABLE_KEY, SITE_URL   optional
set -euo pipefail

cd "$(dirname "$0")"
: "${AWS_REGION:?AWS_REGION is required}"
: "${IMAGE_TAG:?IMAGE_TAG is required}"
: "${TURNSTILE_SITE_KEY:?TURNSTILE_SITE_KEY is required}"
: "${PUSHER_KEY:?PUSHER_KEY is required}"
FIRST_DEPLOY="${FIRST_DEPLOY:-false}"
REALTIME="${REALTIME:-soketi}"

export AWS_DEFAULT_REGION="$AWS_REGION"
export CDK_DEFAULT_REGION="$AWS_REGION"
CDK_DEFAULT_ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
export CDK_DEFAULT_ACCOUNT
REGISTRY="$CDK_DEFAULT_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com"

context=()
add() { if [ -n "${2:-}" ]; then context+=(-c "$1=$2"); fi; }
add imageTag "$IMAGE_TAG"
add turnstileSiteKey "$TURNSTILE_SITE_KEY"
add pusherKey "$PUSHER_KEY"
add pusherAppId "${PUSHER_APP_ID:-}"
add pusherCluster "${PUSHER_CLUSTER:-}"
add realtime "$REALTIME"
add jobs "${JOBS:-}"
add domainName "${DOMAIN_NAME:-}"
add certificateArn "${CERTIFICATE_ARN:-}"
add emailFrom "${EMAIL_FROM:-}"
add stripe "${STRIPE:-}"
add stripePublishableKey "${STRIPE_PUBLISHABLE_KEY:-}"

deploy() { npx cdk deploy "$@" --require-approval never --exclusive; }
output() {
  aws cloudformation describe-stacks --stack-name Foodz \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

npm ci --no-audit --no-fund

echo "Registry stack"
deploy FoodzRegistry "${context[@]}"

if [ "$FIRST_DEPLOY" = "true" ]; then
  echo "Infrastructure, without web tasks (the database is not migrated yet)"
  deploy Foodz "${context[@]}" -c webCount=0
fi

SITE_URL="${SITE_URL:-}"
if [ -z "$SITE_URL" ] && [ -n "${DOMAIN_NAME:-}" ]; then SITE_URL="https://$DOMAIN_NAME"; fi
if [ -z "$SITE_URL" ]; then SITE_URL="$(output SiteUrl)"; fi
if [ -z "$SITE_URL" ] || [ "$SITE_URL" = "None" ]; then
  echo "No site address yet: run once with FIRST_DEPLOY=true." >&2
  exit 1
fi
SITE_HOST="${SITE_URL#https://}"

echo "Building and pushing images as $IMAGE_TAG"
aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY"
build_args=(
  --build-arg "NEXT_PUBLIC_SITE_URL=$SITE_URL"
  --build-arg "NEXT_PUBLIC_PUSHER_KEY=$PUSHER_KEY"
  --build-arg "NEXT_PUBLIC_PUSHER_CLUSTER=${PUSHER_CLUSTER:-mt1}"
  --build-arg "NEXT_PUBLIC_TURNSTILE_SITE_KEY=$TURNSTILE_SITE_KEY"
  --build-arg "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${STRIPE_PUBLISHABLE_KEY:-}"
)
if [ "$REALTIME" = "soketi" ]; then
  build_args+=(
    --build-arg "NEXT_PUBLIC_PUSHER_HOST=$SITE_HOST"
    --build-arg "NEXT_PUBLIC_PUSHER_PORT=443"
    --build-arg "NEXT_PUBLIC_PUSHER_USE_TLS=true"
  )
fi
docker build --target runner "${build_args[@]}" -t "$REGISTRY/foodz:$IMAGE_TAG" ..
docker build --target migrate -t "$REGISTRY/foodz:$IMAGE_TAG-migrate" ..
docker push "$REGISTRY/foodz:$IMAGE_TAG"
docker push "$REGISTRY/foodz:$IMAGE_TAG-migrate"

run_migration() {
  echo "Migrating the database"
  local cluster subnets group task code
  cluster="$(output ClusterName)"
  subnets="$(output MigrateSubnets)"
  group="$(output MigrateSecurityGroup)"
  task="$(aws ecs run-task --cluster "$cluster" --launch-type FARGATE \
    --task-definition foodz-migrate \
    --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$group],assignPublicIp=ENABLED}" \
    --query 'tasks[0].taskArn' --output text)"
  aws ecs wait tasks-stopped --cluster "$cluster" --tasks "$task"
  code="$(aws ecs describe-tasks --cluster "$cluster" --tasks "$task" \
    --query 'tasks[0].containers[0].exitCode' --output text)"
  if [ "$code" != "0" ]; then
    echo "Migration task failed (exit code $code). See the log group /foodz/migrate." >&2
    exit 1
  fi
}

if [ "$FIRST_DEPLOY" = "true" ]; then
  # The migration task definition already points at this tag; run it, then start the web tasks.
  run_migration
  echo "Starting the web tasks"
  deploy Foodz "${context[@]}"
else
  # Migrations must be backward compatible with the running version (expand, then contract),
  # because the web tasks roll over before the migration runs.
  deploy Foodz "${context[@]}"
  run_migration
fi
echo "Done: $SITE_URL"
