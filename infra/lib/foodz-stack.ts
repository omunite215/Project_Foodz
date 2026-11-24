import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  SecretValue,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import type { Construct } from 'constructs';
import type { FoodzConfig } from './config';
import { REPOSITORY_NAME } from './registry-stack';

const DB_NAME = 'foodz';
const DB_ADMIN_USER = 'foodz_admin';
/** Where both images keep the Amazon RDS CA bundle. */
const RDS_CA = '/etc/ssl/rds/global-bundle.pem';
const NAMESPACE = 'foodz.internal';
const WEB_PORT = 3000;
const SOKETI_PORT = 6001;
const INNGEST_PORT = 8288;
/** CloudFront reaches the ALB over the public internet, then this header proves it was CloudFront. */
const ORIGIN_VERIFY_HEADER = 'X-Origin-Verify';

export interface FoodzStackProps extends StackProps {
  config: FoodzConfig;
}

/**
 * Foodz on AWS. Cost-driven shape: no NAT gateway (tasks sit in public subnets with a public
 * address but accept traffic only from the load balancer; the data stores sit in isolated
 * subnets), one small instance of each data store, no WAF, no VPC endpoints.
 *
 *   viewer -> CloudFront -> ALB -> web (Fargate)  ->  RDS (PostgreSQL 17 + PostGIS)
 *                 |            \-> soketi (Fargate)   ElastiCache (Valkey, TLS + AUTH)
 *                 |-> S3 public bucket (/media)      S3 private bucket (task role)
 *   inngest (Fargate) <-> web over Cloud Map DNS (foodz.internal)
 */
export class FoodzStack extends Stack {
  /** Named, not looked up: a lookup would need credentials at synth time. */
  override get availabilityZones(): string[] {
    return [`${this.region}a`, `${this.region}b`];
  }

  constructor(scope: Construct, id: string, props: FoodzStackProps) {
    super(scope, id, props);
    const { config } = props;

    // ------------------------------------------------------------------ network
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'data', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });
    vpc.addFlowLog('FlowLog', {
      destination: ec2.FlowLogDestination.toCloudWatchLogs(
        new logs.LogGroup(this, 'FlowLogs', {
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
      ),
      trafficType: ec2.FlowLogTrafficType.REJECT,
    });

    const albSg = new ec2.SecurityGroup(this, 'AlbSg', { vpc, description: 'Load balancer' });
    const webSg = new ec2.SecurityGroup(this, 'WebSg', { vpc, description: 'Web tasks' });
    const realtimeSg = new ec2.SecurityGroup(this, 'RealtimeSg', {
      vpc,
      description: 'Soketi tasks',
    });
    const jobsSg = new ec2.SecurityGroup(this, 'JobsSg', { vpc, description: 'Inngest tasks' });
    const migrateSg = new ec2.SecurityGroup(this, 'MigrateSg', {
      vpc,
      description: 'Migration task',
    });
    const dbSg = new ec2.SecurityGroup(this, 'DbSg', {
      vpc,
      description: 'PostgreSQL',
      allowAllOutbound: false,
    });
    const cacheSg = new ec2.SecurityGroup(this, 'CacheSg', {
      vpc,
      description: 'Valkey',
      allowAllOutbound: false,
    });
    webSg.addIngressRule(albSg, ec2.Port.tcp(WEB_PORT), 'From the load balancer');
    realtimeSg.addIngressRule(
      albSg,
      ec2.Port.tcp(SOKETI_PORT),
      'Browsers, through the load balancer',
    );
    realtimeSg.addIngressRule(webSg, ec2.Port.tcp(SOKETI_PORT), 'Server-side publishing');
    jobsSg.addIngressRule(webSg, ec2.Port.tcp(INNGEST_PORT), 'Events from the web tasks');
    webSg.addIngressRule(jobsSg, ec2.Port.tcp(WEB_PORT), 'Inngest calls the app');
    dbSg.addIngressRule(webSg, ec2.Port.tcp(5432), 'Web tasks');
    dbSg.addIngressRule(migrateSg, ec2.Port.tcp(5432), 'Migration task');
    cacheSg.addIngressRule(webSg, ec2.Port.tcp(6379), 'Web tasks');
    cacheSg.addIngressRule(jobsSg, ec2.Port.tcp(6379), 'Inngest');

    // ------------------------------------------------------------------ secrets
    // Created by the stack: random values nobody needs to know.
    const randomSecret = (id: string, name: string, length = 48, extra?: { exclude?: string }) =>
      new secretsmanager.Secret(this, id, {
        secretName: `foodz/${name}`,
        generateSecretString: {
          passwordLength: length,
          excludePunctuation: true,
          ...(extra?.exclude ? { excludeCharacters: extra.exclude } : {}),
        },
      });
    const authSecret = randomSecret('AuthSecret', 'better-auth-secret');
    const originVerify = randomSecret('OriginVerify', 'origin-verify', 40);
    const redisToken = randomSecret('RedisToken', 'redis-token', 40);
    const migratorPassword = randomSecret('MigratorPassword', 'db-migrator-password', 32);
    const appPassword = randomSecret('AppPassword', 'db-app-password', 32);
    const readonlyPassword = randomSecret('ReadonlyPassword', 'db-readonly-password', 32);

    // Created by you before the first deploy (see "Deploying to AWS" in the README).
    const appValues = secretsmanager.Secret.fromSecretNameV2(this, 'AppValues', 'foodz/app');

    /** A secret that is a URL built from other secrets; resolved by CloudFormation at deploy time. */
    const composed = (id: string, name: string, value: string) =>
      new secretsmanager.Secret(this, id, {
        secretName: `foodz/${name}`,
        secretStringValue: SecretValue.unsafePlainText(value),
      });
    const plain = (secret: secretsmanager.ISecret) => secret.secretValue.unsafeUnwrap();

    // ------------------------------------------------------------------ database
    const removal = config.retainData ? RemovalPolicy.SNAPSHOT : RemovalPolicy.DESTROY;
    const engine = rds.DatabaseInstanceEngine.postgres({
      version: rds.PostgresEngineVersion.VER_17,
    });
    const database = new rds.DatabaseInstance(this, 'Database', {
      engine,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSg],
      databaseName: DB_NAME,
      credentials: rds.Credentials.fromGeneratedSecret(DB_ADMIN_USER, {
        secretName: 'foodz/db-admin',
      }),
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      multiAz: false,
      backupRetention: Duration.days(7),
      deletionProtection: config.retainData,
      removalPolicy: removal,
      autoMinorVersionUpgrade: true,
      cloudwatchLogsExports: ['postgresql'],
      parameterGroup: new rds.ParameterGroup(this, 'DbParameters', {
        engine,
        parameters: { 'rds.force_ssl': '1' },
      }),
    });
    const dbHost = database.dbInstanceEndpointAddress;
    const adminPassword = plain(database.secret!);
    // TLS is required by the instance and the certificate chain and host name are verified
    // against the RDS CA bundle that both images carry (docker/rds/global-bundle.pem).
    const databaseUrl = composed(
      'DatabaseUrl',
      'database-url',
      `postgresql://foodz_app:${plain(appPassword)}@${dbHost}:5432/${DB_NAME}?sslmode=verify-full&sslrootcert=${RDS_CA}`,
    );
    const migratorUrl = composed(
      'MigratorUrl',
      'database-migrator-url',
      `postgresql://foodz_migrator:${plain(migratorPassword)}@${dbHost}:5432/${DB_NAME}?sslmode=require&sslcert=${RDS_CA}&sslaccept=strict`,
    );
    const adminUrl = composed(
      'AdminUrl',
      'database-admin-url',
      `postgresql://${DB_ADMIN_USER}:${adminPassword}@${dbHost}:5432/${DB_NAME}?sslmode=verify-full&sslrootcert=${RDS_CA}`,
    );

    // ------------------------------------------------------------------ cache
    const cacheSubnets = new elasticache.CfnSubnetGroup(this, 'CacheSubnets', {
      description: 'Foodz cache',
      subnetIds: vpc.isolatedSubnets.map((subnet) => subnet.subnetId),
    });
    const cache = new elasticache.CfnReplicationGroup(this, 'Cache', {
      replicationGroupDescription: 'Foodz rate limits and live positions',
      engine: 'valkey',
      engineVersion: '8.0',
      cacheNodeType: 'cache.t4g.micro',
      numCacheClusters: 1,
      automaticFailoverEnabled: false,
      atRestEncryptionEnabled: true,
      transitEncryptionEnabled: true,
      authToken: plain(redisToken),
      cacheSubnetGroupName: cacheSubnets.ref,
      securityGroupIds: [cacheSg.securityGroupId],
      port: 6379,
      snapshotRetentionLimit: 1,
    });
    const redisUrl = composed(
      'RedisUrl',
      'redis-url',
      `rediss://:${plain(redisToken)}@${cache.attrPrimaryEndPointAddress}:6379`,
    );

    // ------------------------------------------------------------------ buckets
    const corsOrigin = config.domainName ? `https://${config.domainName}` : '*';
    const bucket = (id: string) =>
      new s3.Bucket(this, id, {
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        enforceSSL: true,
        encryption: s3.BucketEncryption.S3_MANAGED,
        removalPolicy: RemovalPolicy.RETAIN,
        cors: [
          {
            allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
            allowedOrigins: [corsOrigin],
            allowedHeaders: ['content-type', 'content-length', 'x-amz-*'],
            maxAge: 3000,
          },
        ],
      });
    // Read only through CloudFront (/media); never public on its own.
    const publicBucket = bucket('PublicBucket');
    // Personal files and the quarantine area; read only through short-lived signed links.
    const privateBucket = bucket('PrivateBucket');
    privateBucket.addLifecycleRule({
      id: 'expire-quarantine',
      prefix: 'quarantine/',
      expiration: Duration.days(1),
      abortIncompleteMultipartUploadAfter: Duration.days(1),
    });
    publicBucket.addLifecycleRule({ abortIncompleteMultipartUploadAfter: Duration.days(1) });

    // ------------------------------------------------------------------ cluster
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      defaultCloudMapNamespace: {
        name: NAMESPACE,
        type: servicediscovery.NamespaceType.DNS_PRIVATE,
        vpc,
      },
    });
    const repository = ecr.Repository.fromRepositoryName(this, 'Repository', REPOSITORY_NAME);
    const logDriver = (name: string) =>
      ecs.LogDrivers.awsLogs({
        streamPrefix: name,
        logGroup: new logs.LogGroup(this, `${name}Logs`, {
          logGroupName: `/foodz/${name}`,
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
      });
    const fromSecret = (secret: secretsmanager.ISecret, field?: string) =>
      ecs.Secret.fromSecretsManager(secret, field);

    // ------------------------------------------------------------------ load balancer + CDN
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      dropInvalidHeaderFields: true,
    });
    // Anything that did not come through CloudFront (no matching header) gets a 403.
    const listener = alb.addListener('Http', {
      port: 80,
      open: true,
      defaultAction: elbv2.ListenerAction.fixedResponse(403, {
        contentType: 'text/plain',
        messageBody: 'Forbidden',
      }),
    });
    const fromCloudFront = elbv2.ListenerCondition.httpHeader(ORIGIN_VERIFY_HEADER, [
      plain(originVerify),
    ]);

    const albOrigin = new origins.HttpOrigin(alb.loadBalancerDnsName, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      customHeaders: { [ORIGIN_VERIFY_HEADER]: plain(originVerify) },
    });
    const stripMediaPrefix = new cloudfront.Function(this, 'StripMediaPrefix', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(
        "function handler(event) { var request = event.request; request.uri = request.uri.replace(/^\\/media/, '') || '/'; return request; }",
      ),
    });
    const dynamic = {
      origin: albOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
    };
    const distribution = new cloudfront.Distribution(this, 'Cdn', {
      comment: 'Foodz',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      ...(config.domainName && config.certificateArn
        ? {
            domainNames: [config.domainName],
            certificate: acm.Certificate.fromCertificateArn(
              this,
              'Certificate',
              config.certificateArn,
            ),
            minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
          }
        : {}),
      defaultBehavior: dynamic,
      additionalBehaviors: {
        '/_next/static/*': {
          ...dynamic,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          compress: true,
        },
        '/media/*': {
          origin: origins.S3BucketOrigin.withOriginAccessControl(publicBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          compress: true,
          functionAssociations: [
            {
              function: stripMediaPrefix,
              eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            },
          ],
        },
        // Browsers' WebSocket connections to Soketi (CloudFront passes the upgrade through).
        '/app/*': dynamic,
      },
    });
    const siteHost = config.domainName ?? distribution.distributionDomainName;
    const siteUrl = `https://${siteHost}`;

    // ------------------------------------------------------------------ shared task settings
    const soketiOn = config.realtime === 'soketi';
    const inngestOn = config.jobs === 'inngest';
    const realtimeSecret = soketiOn
      ? randomSecret('RealtimeSecret', 'realtime-secret', 40)
      : secretsmanager.Secret.fromSecretNameV2(this, 'PusherValues', 'foodz/realtime');
    const inngestEventKey = inngestOn
      ? randomSecret('InngestEventKey', 'inngest-event-key', 64, {
          exclude: 'ghijklmnopqrstuvwxyzGHIJKLMNOPQRSTUVWXYZ',
        })
      : undefined;
    const inngestSigningKey = inngestOn
      ? randomSecret('InngestSigningKey', 'inngest-signing-key', 64, {
          exclude: 'ghijklmnopqrstuvwxyzGHIJKLMNOPQRSTUVWXYZ',
        })
      : undefined;
    const inngestCloud = inngestOn
      ? undefined
      : secretsmanager.Secret.fromSecretNameV2(this, 'InngestCloudValues', 'foodz/inngest');
    const stripeValues = config.stripe
      ? secretsmanager.Secret.fromSecretNameV2(this, 'StripeValues', 'foodz/stripe')
      : undefined;

    const realtimeEnv: Record<string, string> = soketiOn
      ? {
          PUSHER_HOST: `realtime.${NAMESPACE}`,
          PUSHER_PORT: String(SOKETI_PORT),
          PUSHER_USE_TLS: 'false',
          NEXT_PUBLIC_PUSHER_HOST: siteHost,
          NEXT_PUBLIC_PUSHER_PORT: '443',
          NEXT_PUBLIC_PUSHER_USE_TLS: 'true',
        }
      : { PUSHER_USE_TLS: 'true' };

    const webEnvironment: Record<string, string> = {
      NODE_ENV: 'production',
      // Test-only switches (CLIENT_IP_FROM_HEADER, INNGEST_DEV) are refused when this is set.
      FOODZ_DEPLOYMENT: 'production',
      LOG_LEVEL: 'info',
      NEXT_PUBLIC_SITE_URL: siteUrl,
      BETTER_AUTH_URL: siteUrl,
      // CloudFront appends the viewer address, the ALB appends CloudFront's: two hops.
      TRUSTED_PROXY_HOPS: '2',
      S3_REGION: this.region,
      S3_PUBLIC_BUCKET: publicBucket.bucketName,
      S3_PRIVATE_BUCKET: privateBucket.bucketName,
      S3_PUBLIC_URL: `${siteUrl}/media`,
      EMAIL_FROM: config.emailFrom,
      PUSHER_APP_ID: config.pusherAppId,
      NEXT_PUBLIC_PUSHER_KEY: config.pusherKey,
      NEXT_PUBLIC_PUSHER_CLUSTER: config.pusherCluster,
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: config.turnstileSiteKey,
      ...(config.stripePublishableKey
        ? { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: config.stripePublishableKey }
        : {}),
      ...(inngestOn ? { INNGEST_BASE_URL: `http://jobs.${NAMESPACE}:${INNGEST_PORT}` } : {}),
      ...realtimeEnv,
    };
    const webSecrets: Record<string, ecs.Secret> = {
      DATABASE_URL: fromSecret(databaseUrl),
      REDIS_URL: fromSecret(redisUrl),
      BETTER_AUTH_SECRET: fromSecret(authSecret),
      PUSHER_SECRET: soketiOn
        ? fromSecret(realtimeSecret)
        : fromSecret(realtimeSecret, 'PUSHER_SECRET'),
      SMTP_URL: fromSecret(appValues, 'SMTP_URL'),
      FIELD_ENCRYPTION_KEY: fromSecret(appValues, 'FIELD_ENCRYPTION_KEY'),
      TURNSTILE_SECRET_KEY: fromSecret(appValues, 'TURNSTILE_SECRET_KEY'),
      ...(inngestEventKey && inngestSigningKey
        ? {
            INNGEST_EVENT_KEY: fromSecret(inngestEventKey),
            INNGEST_SIGNING_KEY: fromSecret(inngestSigningKey),
          }
        : inngestCloud
          ? {
              INNGEST_EVENT_KEY: fromSecret(inngestCloud, 'INNGEST_EVENT_KEY'),
              INNGEST_SIGNING_KEY: fromSecret(inngestCloud, 'INNGEST_SIGNING_KEY'),
            }
          : {}),
      ...(stripeValues
        ? {
            STRIPE_SECRET_KEY: fromSecret(stripeValues, 'STRIPE_SECRET_KEY'),
            STRIPE_WEBHOOK_SECRET: fromSecret(stripeValues, 'STRIPE_WEBHOOK_SECRET'),
          }
        : {}),
    };

    // ------------------------------------------------------------------ web service
    const webTask = new ecs.FargateTaskDefinition(this, 'WebTask', {
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    // S3 through the task role: no access keys anywhere (server/storage/s3-config.ts).
    webTask.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
        resources: [publicBucket.arnForObjects('*'), privateBucket.arnForObjects('*')],
      }),
    );
    webTask.addContainer('web', {
      image: ecs.ContainerImage.fromEcrRepository(repository, config.imageTag),
      portMappings: [{ containerPort: WEB_PORT }],
      environment: webEnvironment,
      secrets: webSecrets,
      logging: logDriver('web'),
      healthCheck: {
        command: [
          'CMD-SHELL',
          `node -e "fetch('http://127.0.0.1:${WEB_PORT}/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`,
        ],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(30),
      },
    });
    const webService = new ecs.FargateService(this, 'WebService', {
      cluster,
      taskDefinition: webTask,
      desiredCount: config.webCount,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [webSg],
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      healthCheckGracePeriod: Duration.seconds(60),
      cloudMapOptions: {
        name: 'web',
        dnsRecordType: servicediscovery.DnsRecordType.A,
        dnsTtl: Duration.seconds(10),
      },
    });
    const webTargets = new elbv2.ApplicationTargetGroup(this, 'WebTargets', {
      vpc,
      port: WEB_PORT,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      targets: [webService],
      deregistrationDelay: Duration.seconds(30),
      healthCheck: {
        path: '/api/health',
        healthyHttpCodes: '200',
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
      },
    });
    listener.addAction('Web', {
      priority: 20,
      conditions: [fromCloudFront],
      action: elbv2.ListenerAction.forward([webTargets]),
    });
    if (config.webCount > 0) {
      const scaling = webService.autoScaleTaskCount({
        minCapacity: config.webCount,
        maxCapacity: Math.max(config.webCount, 4),
      });
      scaling.scaleOnCpuUtilization('Cpu', {
        targetUtilizationPercent: 60,
        scaleInCooldown: Duration.minutes(5),
        scaleOutCooldown: Duration.minutes(1),
      });
      scaling.scaleOnRequestCount('Requests', {
        requestsPerTarget: 500,
        targetGroup: webTargets,
        policyName: 'requests',
      });
    }

    // ------------------------------------------------------------------ soketi (optional)
    if (soketiOn) {
      const task = new ecs.FargateTaskDefinition(this, 'RealtimeTask', {
        cpu: 256,
        memoryLimitMiB: 512,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.X86_64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      });
      task.addContainer('soketi', {
        image: ecs.ContainerImage.fromRegistry('quay.io/soketi/soketi:1.6-16-alpine'),
        portMappings: [{ containerPort: SOKETI_PORT }],
        environment: {
          SOKETI_DEFAULT_APP_ID: config.pusherAppId,
          SOKETI_DEFAULT_APP_KEY: config.pusherKey,
          SOKETI_DEFAULT_APP_ENABLE_CLIENT_MESSAGES: 'false',
        },
        secrets: { SOKETI_DEFAULT_APP_SECRET: fromSecret(realtimeSecret) },
        logging: logDriver('realtime'),
      });
      const service = new ecs.FargateService(this, 'RealtimeService', {
        cluster,
        taskDefinition: task,
        desiredCount: config.webCount > 0 ? 1 : 0,
        assignPublicIp: true,
        vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
        securityGroups: [realtimeSg],
        circuitBreaker: { rollback: true },
        minHealthyPercent: 100,
        cloudMapOptions: {
          name: 'realtime',
          dnsRecordType: servicediscovery.DnsRecordType.A,
          dnsTtl: Duration.seconds(10),
        },
      });
      const targets = new elbv2.ApplicationTargetGroup(this, 'RealtimeTargets', {
        vpc,
        port: SOKETI_PORT,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targetType: elbv2.TargetType.IP,
        targets: [service],
        deregistrationDelay: Duration.seconds(30),
        healthCheck: { path: '/ready', healthyHttpCodes: '200' },
      });
      listener.addAction('Realtime', {
        priority: 10,
        conditions: [fromCloudFront, elbv2.ListenerCondition.pathPatterns(['/app/*'])],
        action: elbv2.ListenerAction.forward([targets]),
      });
    }

    // ------------------------------------------------------------------ inngest (optional)
    if (inngestOn && inngestEventKey && inngestSigningKey) {
      const task = new ecs.FargateTaskDefinition(this, 'JobsTask', {
        cpu: 256,
        memoryLimitMiB: 512,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.X86_64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      });
      // Queue state lives in Valkey; the local SQLite file (run history) is lost on redeploy.
      task.addContainer('inngest', {
        image: ecs.ContainerImage.fromRegistry('inngest/inngest:v1.52.0'),
        command: [
          'inngest',
          'start',
          '--host',
          '0.0.0.0',
          '--port',
          String(INNGEST_PORT),
          '-u',
          `http://web.${NAMESPACE}:${WEB_PORT}/api/inngest`,
        ],
        portMappings: [{ containerPort: INNGEST_PORT }],
        environment: { INNGEST_SQLITE_DIR: '/tmp' },
        secrets: {
          INNGEST_EVENT_KEY: fromSecret(inngestEventKey),
          INNGEST_SIGNING_KEY: fromSecret(inngestSigningKey),
          INNGEST_REDIS_URI: fromSecret(redisUrl),
        },
        logging: logDriver('jobs'),
      });
      new ecs.FargateService(this, 'JobsService', {
        cluster,
        taskDefinition: task,
        desiredCount: config.webCount > 0 ? 1 : 0,
        assignPublicIp: true,
        vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
        securityGroups: [jobsSg],
        circuitBreaker: { rollback: true },
        minHealthyPercent: 100,
        cloudMapOptions: {
          name: 'jobs',
          dnsRecordType: servicediscovery.DnsRecordType.A,
          dnsTtl: Duration.seconds(10),
        },
      });
    }

    // ------------------------------------------------------------------ migration task (run on demand)
    const migrateTask = new ecs.FargateTaskDefinition(this, 'MigrateTask', {
      family: 'foodz-migrate',
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    migrateTask.addContainer('migrate', {
      image: ecs.ContainerImage.fromEcrRepository(repository, `${config.imageTag}-migrate`),
      logging: logDriver('migrate'),
      secrets: {
        DATABASE_ADMIN_URL: fromSecret(adminUrl),
        DATABASE_MIGRATOR_URL: fromSecret(migratorUrl),
        DB_MIGRATOR_PASSWORD: fromSecret(migratorPassword),
        DB_APP_PASSWORD: fromSecret(appPassword),
        DB_READONLY_PASSWORD: fromSecret(readonlyPassword),
        BETTER_AUTH_SECRET: fromSecret(authSecret),
        SEED_ADMIN_EMAIL: fromSecret(appValues, 'SEED_ADMIN_EMAIL'),
        SEED_ADMIN_PASSWORD: fromSecret(appValues, 'SEED_ADMIN_PASSWORD'),
        DEMO_PASSWORD: fromSecret(appValues, 'DEMO_PASSWORD'),
      },
    });

    // ------------------------------------------------------------------ outputs
    const out = (id: string, value: string, description: string) =>
      new CfnOutput(this, id, { value, description });
    out('SiteUrl', siteUrl, 'Public address of the site');
    out('DistributionDomain', distribution.distributionDomainName, 'Point your DNS name here');
    out('ClusterName', cluster.clusterName, 'ECS cluster');
    out('WebServiceName', webService.serviceName, 'ECS service running the web app');
    out('MigrateTaskFamily', migrateTask.family, 'Task definition to run for migrations');
    out(
      'MigrateSubnets',
      vpc.publicSubnets.map((subnet) => subnet.subnetId).join(','),
      'Subnets for the migration task',
    );
    out('MigrateSecurityGroup', migrateSg.securityGroupId, 'Security group for the migration task');
  }
}
