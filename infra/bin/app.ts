#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { OrdersMcpStack } from '../lib/orders-mcp-stack';

const app = new cdk.App();

// Optional: cdk deploy -c policyMode=LOG_ONLY to watch decisions before enforcing them.
const policyMode: unknown = app.node.tryGetContext('policyMode') ?? 'ENFORCE';
if (policyMode !== 'ENFORCE' && policyMode !== 'LOG_ONLY') {
  throw new Error(`policyMode must be ENFORCE or LOG_ONLY, got ${JSON.stringify(policyMode)}`);
}
const domainPrefix: unknown = app.node.tryGetContext('domainPrefix');
if (domainPrefix !== undefined && (typeof domainPrefix !== 'string' || !/^[a-z0-9-]{1,63}$/.test(domainPrefix))) {
  throw new Error('domainPrefix must be lowercase letters, digits and hyphens');
}

new OrdersMcpStack(app, 'OrdersMcpGateway', {
  policyMode,
  domainPrefix,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1' },
});

// Fail synth on any AWS Solutions finding that isn't acknowledged with a reason.
cdk.Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));
