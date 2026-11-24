import { App, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { readConfig } from './config';
import { FoodzStack } from './foodz-stack';
import { addSuppressions } from './nag-suppressions';
import { RegistryStack } from './registry-stack';

/**
 * No account or region is baked in: `cdk synth` needs no credentials and does no lookups. A real
 * deploy takes both from the environment (CDK_DEFAULT_ACCOUNT / CDK_DEFAULT_REGION, set by the
 * CDK CLI from the credentials in use). The values below are placeholders for offline synthesis.
 */
export function buildApp(context: Record<string, unknown> = {}) {
  const app = new App({ context });
  const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT ?? '000000000000',
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  };
  const config = readConfig((key) => app.node.tryGetContext(key));

  const registry = new RegistryStack(app, 'FoodzRegistry', { env });
  const foodz = new FoodzStack(app, 'Foodz', { env, config });
  foodz.addStackDependency(registry);

  Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));
  addSuppressions(registry, foodz, config);
  return app;
}
