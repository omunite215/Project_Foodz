import { Validations, type Stack } from 'aws-cdk-lib';
import { CfnSecret } from 'aws-cdk-lib/aws-secretsmanager';
import type { IConstruct } from 'constructs';
import type { FoodzConfig } from './config';

/*
 * cdk-nag (AwsSolutions pack) findings that are accepted, each with the reason. Findings that
 * could be fixed in code were fixed; what remains is a deliberate trade-off, mostly cost for a
 * small deployment. Revisit when traffic or a compliance need justifies the spend.
 */
export function addSuppressions(registry: Stack, foodz: Stack, config: FoodzConfig) {
  void registry;
  const at = (path: string): IConstruct => {
    const found = foodz.node
      .findAll()
      .find((node) => node.node.path === `${foodz.node.path}/${path}`);
    if (!found) throw new Error(`Suppression target not found: ${path}`);
    return found;
  };
  const accept = (path: string, id: string, reason: string) =>
    Validations.of(at(path)).acknowledge({ id, reason });
  const optional = (path: string, id: string, reason: string) => {
    if (foodz.node.tryFindChild(path.split('/')[0] ?? '')) accept(path, id, reason);
  };

  for (const node of foodz.node.findAll()) {
    if (node instanceof CfnSecret) {
      Validations.of(node).acknowledge({
        id: 'AwsSolutions-SMG4',
        reason:
          'Generated values are random and stored only here; they are rotated by replacing the secret and redeploying (documented in the README). Composed URL secrets follow their sources. Automatic rotation needs a rotation Lambda per secret and the database roles are re-keyed by the migration task, so it is deferred.',
      });
    }
  }

  accept(
    'AlbSg/Resource',
    'AwsSolutions-EC23',
    'The load balancer is the public entry point on port 80 only. Requests that do not carry the CloudFront secret header get a 403 from the listener, and the tasks accept traffic from this group alone. CloudFront has no fixed address range that can be listed without a prefix-list lookup, which needs credentials at synth time.',
  );
  accept(
    'Database/Resource',
    'AwsSolutions-RDS3',
    'Single-AZ keeps the idle cost of the database down; automated backups (7 days) cover recovery. Turn on multiAz when availability matters more than the cost of a second instance.',
  );
  accept(
    'Database/Resource',
    'AwsSolutions-RDS11',
    'The instance sits in isolated subnets and accepts connections only from the web and migration task security groups, so a non-default port adds nothing.',
  );
  accept(
    'Cache',
    'AwsSolutions-AEC4',
    'One cache node: the data is rate-limit counters and live courier positions, which are rebuilt within seconds if the node is replaced. A replica would double the cost.',
  );
  for (const bucket of ['PublicBucket', 'PrivateBucket']) {
    accept(
      `${bucket}/Resource`,
      'AwsSolutions-S1',
      'Server access logs would need a separate log bucket with its own lifecycle. CloudTrail data events and CloudFront logs cover access when needed; the buckets are not public and enforce TLS.',
    );
  }
  accept(
    'Cluster/Resource',
    'AwsSolutions-ECS4',
    'Container Insights bills custom metrics even when the service is idle. Task logs and the service CPU and memory metrics are enough at this size.',
  );
  accept(
    'Alb/Resource',
    'AwsSolutions-ELB2',
    'Access logs need a log bucket with a bucket policy for the regional ELB account. Not worth the extra resources for a service CloudFront already fronts and logs.',
  );
  for (const rule of ['AwsSolutions-CFR1', 'AwsSolutions-CFR2', 'AwsSolutions-CFR3']) {
    const reasons: Record<string, string> = {
      'AwsSolutions-CFR1':
        'Geo restriction is a business rule (where delivery is offered) that is set at the edge once it is decided, not a default.',
      'AwsSolutions-CFR2':
        'AWS WAF costs a monthly fee per web ACL and per rule even when idle. The app has its own rate limits, Turnstile on forms and a strict CSP; add a WAF web ACL if traffic justifies it.',
      'AwsSolutions-CFR3':
        'CloudFront standard logs need a log bucket with ACLs enabled. The ALB and app logs in CloudWatch cover request tracing for now.',
    };
    accept('Cdn/Resource', rule, reasons[rule] ?? '');
  }
  accept(
    'Cdn/Resource',
    'AwsSolutions-CFR5',
    'CloudFront reaches the ALB over HTTP: an HTTPS listener needs a certificate for a name pointing at the ALB, which does not exist without a domain. The ALB only answers requests that carry the secret origin header, and traffic never leaves the AWS network backbone. Add an ALB certificate and switch the origin to HTTPS when a domain is used.',
  );
  if (!config.domainName) {
    accept(
      'Cdn/Resource',
      'AwsSolutions-CFR4',
      'Without a custom domain CloudFront serves its default certificate, which allows TLS 1.0. Setting domainName and certificateArn applies TLS 1.2 as the minimum.',
    );
  }

  const iamObjects =
    'The task role may read, write and delete objects in these two buckets only; object keys are generated by the app, so the key part of the ARN cannot be narrowed.';
  accept('WebTask/TaskRole/DefaultPolicy/Resource', 'AwsSolutions-IAM5', iamObjects);
  const ecrToken =
    'ecr:GetAuthorizationToken does not support resource-level permissions; the same policy scopes image pulls to the repository.';
  accept('WebTask/ExecutionRole/DefaultPolicy/Resource', 'AwsSolutions-IAM5', ecrToken);
  accept('MigrateTask/ExecutionRole/DefaultPolicy/Resource', 'AwsSolutions-IAM5', ecrToken);
  for (const task of ['WebTask', 'MigrateTask', 'RealtimeTask', 'JobsTask']) {
    optional(
      `${task}/Resource`,
      'AwsSolutions-ECS2',
      'Only non-sensitive settings (URLs, bucket names, public keys) are plain environment variables. Every credential comes from Secrets Manager through the task definition.',
    );
  }
}
