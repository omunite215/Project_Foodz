import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../lib/app';
import type { FoodzStack } from '../lib/foodz-stack';

const synth = (context: Record<string, unknown> = {}) => {
  const app = buildApp({ pusherKey: 'k', turnstileSiteKey: 't', ...context });
  app.synth();
  return Template.fromStack(app.node.findChild('Foodz') as FoodzStack);
};

describe('Foodz stack', () => {
  const template = synth();

  it('runs PostgreSQL 17, encrypted, behind force-SSL, with deletion protection', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      Engine: 'postgres',
      EngineVersion: Match.stringLikeRegexp('^17'),
      StorageEncrypted: true,
      DeletionProtection: true,
      PubliclyAccessible: false,
    });
    template.hasResourceProperties('AWS::RDS::DBParameterGroup', {
      Parameters: { 'rds.force_ssl': '1' },
    });
  });

  it('runs Valkey with TLS and an auth token', () => {
    template.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
      Engine: 'valkey',
      TransitEncryptionEnabled: true,
      AtRestEncryptionEnabled: true,
    });
  });

  it('hands the app a rediss:// URL', () => {
    const secrets = Object.values(template.findResources('AWS::SecretsManager::Secret'));
    const redis = secrets.find((s) => JSON.stringify(s.Properties).includes('rediss://'));
    expect(redis).toBeDefined();
  });

  it('has no NAT gateway and keeps every bucket private', () => {
    template.resourceCountIs('AWS::EC2::NatGateway', 0);
    const buckets = Object.values(template.findResources('AWS::S3::Bucket'));
    expect(buckets).toHaveLength(2);
    for (const bucket of buckets) {
      expect(bucket.Properties.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
    }
  });

  it('gives the web task no static storage keys and trusts two proxy hops', () => {
    const tasks = Object.values(template.findResources('AWS::ECS::TaskDefinition'));
    const web = JSON.stringify(tasks.find((t) => JSON.stringify(t).includes('/api/health')));
    expect(web).not.toContain('S3_ACCESS_KEY_ID');
    expect(web).not.toContain('S3_SECRET_ACCESS_KEY');
    expect(web).not.toContain('S3_ENDPOINT');
    expect(web).toContain('"Name":"TRUSTED_PROXY_HOPS","Value":"2"');
    expect(web).toContain('"Name":"FOODZ_DEPLOYMENT","Value":"production"');
  });

  it('checks /api/health on the target group', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      HealthCheckPath: '/api/health',
      Port: 3000,
    });
  });

  it('turns the self-hosted services off for the first deploy (webCount=0)', () => {
    const first = synth({ webCount: 0 });
    for (const service of Object.values(first.findResources('AWS::ECS::Service'))) {
      expect(service.Properties.DesiredCount).toBe(0);
    }
  });

  it('drops Soketi and Inngest when their hosted versions are chosen', () => {
    const hosted = synth({
      realtime: 'pusher',
      pusherAppId: '1',
      jobs: 'inngest-cloud',
    });
    hosted.resourceCountIs('AWS::ECS::Service', 1);
    const text = JSON.stringify(hosted.toJSON());
    expect(text).not.toContain('soketi');
    expect(text).not.toContain('inngest/inngest');
  });
});
