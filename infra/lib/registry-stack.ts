import { RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import type { Construct } from 'constructs';

export const REPOSITORY_NAME = 'foodz';

/**
 * The image repository, in its own stack because the images must exist before the application
 * stack can start a task from them: deploy this first, push the images, then deploy the rest.
 * The runtime image is tagged `<tag>`, the migration image `<tag>-migrate`.
 */
export class RegistryStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    new ecr.Repository(this, 'Repository', {
      repositoryName: REPOSITORY_NAME,
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      encryption: ecr.RepositoryEncryption.AES_256,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [{ description: 'Keep the 30 newest images', maxImageCount: 30 }],
    });
  }
}
