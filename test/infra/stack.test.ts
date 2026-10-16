import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AwsSolutionsChecks } from 'cdk-nag';
import { DEFAULT_NEGOTIATED_PROTOCOL_VERSION, LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { BUILD_DIR, OrdersMcpStack } from '../../infra/lib/orders-mcp-stack';
import { ADMIN_SCOPE, POLICIES } from '../../infra/lib/policies';
import { ADMIN_TARGET, ADMIN_TOOLS, READ_TARGET, READ_TOOLS } from '../../app/src/tools/definitions';

const env = { account: '123456789012', region: 'us-east-1' };
function synth(props = {}) {
  const app = new cdk.App();
  const stack = new OrdersMcpStack(app, 'Test', { env, ...props });
  return { app, stack, template: Template.fromStack(stack) };
}
const { template } = synth();
const resources = (type: string) => Object.entries<any>(template.findResources(type));
const one = (type: string) => {
  const all = resources(type);
  expect(all).toHaveLength(1);
  return all[0]![1];
};

/** CloudFormation renders schema keys capitalised; turn our definitions into that shape. */
function cfnShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cfnShape);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => {
        const key = k[0]!.toUpperCase() + k.slice(1);
        // Property names inside `properties` are data, not schema keys: keep them as written.
        if (k === 'properties') return [key, Object.fromEntries(Object.entries(v as object).map(([pk, pv]) => [pk, cfnShape(pv)]))];
        return [key, cfnShape(v)];
      }),
    );
  }
  return value;
}

describe('gateway', () => {
  it('speaks MCP and checks Cognito JWTs from our two agent clients only', () => {
    const gw = one('AWS::BedrockAgentCore::Gateway').Properties;
    expect(gw.ProtocolType).toBe('MCP');
    expect(gw.AuthorizerType).toBe('CUSTOM_JWT');
    const jwt = gw.AuthorizerConfiguration.CustomJWTAuthorizer;
    expect(JSON.stringify(jwt.DiscoveryUrl)).toContain('/.well-known/openid-configuration');
    expect(jwt.AllowedClients).toEqual([{ Ref: expect.stringMatching(/^AgentPoolReaderAgent/) }, { Ref: expect.stringMatching(/^AgentPoolOpsAgent/) }]);
  });

  it('accepts requests with no MCP-Protocol-Version header, which the gateway treats as 2025-03-26', () => {
    const versions = one('AWS::BedrockAgentCore::Gateway').Properties.ProtocolConfiguration.Mcp.SupportedVersions;
    expect(versions).toContain('2025-03-26');
    // The official SDK client sends initialize with no header, then the version it negotiated.
    expect(versions).toContain(DEFAULT_NEGOTIATED_PROTOCOL_VERSION);
    expect(versions).toContain(LATEST_PROTOCOL_VERSION);
  });

  it('enforces the policy engine by default, and LOG_ONLY is opt-in', () => {
    expect(one('AWS::BedrockAgentCore::Gateway').Properties.PolicyEngineConfiguration).toEqual({
      Arn: { 'Fn::GetAtt': ['PolicyEngine', 'PolicyEngineArn'] },
      Mode: 'ENFORCE',
    });
    const logOnly = synth({ policyMode: 'LOG_ONLY' }).template;
    logOnly.hasResourceProperties('AWS::BedrockAgentCore::Gateway', { PolicyEngineConfiguration: Match.objectLike({ Mode: 'LOG_ONLY' }) });
  });

  it('does not turn on DEBUG exception detail, which would send internal errors to agents', () => {
    expect(one('AWS::BedrockAgentCore::Gateway').Properties.ExceptionLevel).toBeUndefined();
  });

  it('waits for its role policy, so the first tool call does not race the permissions', () => {
    const [, gw] = resources('AWS::BedrockAgentCore::Gateway')[0]!;
    expect(gw.DependsOn).toEqual(expect.arrayContaining([expect.stringMatching(/^GatewayRoleDefaultPolicy/)]));
  });
});

describe('targets', () => {
  it('deploy exactly the tool definitions the local MCP server lists', () => {
    const targets = Object.fromEntries(resources('AWS::BedrockAgentCore::GatewayTarget').map(([, r]) => [r.Properties.Name, r.Properties]));
    expect(Object.keys(targets).sort()).toEqual([ADMIN_TARGET, READ_TARGET].sort());
    expect(targets[READ_TARGET].TargetConfiguration.Mcp.Lambda.ToolSchema.InlinePayload).toEqual(cfnShape(READ_TOOLS));
    expect(targets[ADMIN_TARGET].TargetConfiguration.Mcp.Lambda.ToolSchema.InlinePayload).toEqual(cfnShape(ADMIN_TOOLS));
  });

  it('send the destructive tool to its own function', () => {
    const targets = Object.fromEntries(resources('AWS::BedrockAgentCore::GatewayTarget').map(([, r]) => [r.Properties.Name, r.Properties]));
    expect(targets[READ_TARGET].TargetConfiguration.Mcp.Lambda.LambdaArn).toEqual({ 'Fn::GetAtt': [expect.stringMatching(/^readerFn/), 'Arn'] });
    expect(targets[ADMIN_TARGET].TargetConfiguration.Mcp.Lambda.LambdaArn).toEqual({ 'Fn::GetAtt': [expect.stringMatching(/^adminFn/), 'Arn'] });
    for (const t of Object.values<any>(targets)) expect(t.CredentialProviderConfigurations).toEqual([{ CredentialProviderType: 'GATEWAY_IAM_ROLE' }]);
  });
});

describe('policy', () => {
  const policies = () => resources('AWS::BedrockAgentCore::Policy').map(([, r]) => r);

  it('creates one Cedar policy per template, after both targets exist', () => {
    expect(policies().map((p) => p.Properties.Name).sort()).toEqual(POLICIES.map((p) => p.name).sort());
    for (const p of policies()) {
      expect(p.DependsOn).toEqual(expect.arrayContaining(['ReadTarget', 'AdminTarget']));
      expect(p.Properties.ValidationMode).toBe('FAIL_ON_ANY_FINDINGS');
      expect(p.Properties.Definition.Cedar.Statement['Fn::Sub'][1]).toEqual({ GatewayArn: { 'Fn::GetAtt': ['Gateway', 'GatewayArn'] } });
    }
  });

  it('permits cancel_order only with the admin scope, and nothing else mentions it', () => {
    const statements = POLICIES.map((p) => p.statement);
    const cancel = statements.filter((s) => s.includes(`${ADMIN_TARGET}___cancel_order`));
    expect(cancel).toHaveLength(1);
    expect(cancel[0]).toContain('principal.hasTag("scope") &&');
    expect(cancel[0]).toContain(`principal.getTag("scope") like "*${ADMIN_SCOPE}*"`);
    // No statement may permit every action: that would include cancel_order.
    for (const s of statements) expect(s).not.toMatch(/^\s*action\s*,/m);
  });

  it('lists every read tool and only read tools in the read policy', () => {
    const read = POLICIES.find((p) => p.name === 'allow_read_tools')!.statement;
    for (const t of READ_TOOLS) expect(read).toContain(`"${READ_TARGET}___${t.name}"`);
    for (const t of ADMIN_TOOLS) expect(read).not.toContain(t.name);
  });
});

describe('IAM', () => {
  it('the gateway role trusts AgentCore only from this account', () => {
    const role = resources('AWS::IAM::Role').find(([id]) => id.startsWith('GatewayRole'))![1].Properties;
    const [stmt] = role.AssumeRolePolicyDocument.Statement;
    expect(stmt.Principal).toEqual({ Service: 'bedrock-agentcore.amazonaws.com' });
    expect(stmt.Condition.StringEquals['aws:SourceAccount']).toBe('123456789012');
    // The partition renders as a literal or a Ref depending on feature flags.
    expect(JSON.stringify(stmt.Condition.ArnLike['aws:SourceArn'])).toMatch(/:bedrock-agentcore:us-east-1:123456789012:gateway\/\*"/);
  });

  it('the gateway role may invoke the two tool functions and ask the policy engine, nothing more', () => {
    const policy = resources('AWS::IAM::Policy').find(([id]) => id.startsWith('GatewayRole'))![1].Properties.PolicyDocument;
    const actions = policy.Statement.flatMap((s: any) => [s.Action].flat()).sort();
    expect(actions).toEqual(['bedrock-agentcore:AuthorizeAction', 'bedrock-agentcore:GetPolicyEngine', 'bedrock-agentcore:PartiallyAuthorizeActions', 'lambda:InvokeFunction']);
  });

  it('the reader function can not write and the admin function can not read', () => {
    const fnPolicy = (prefix: string) => resources('AWS::IAM::Policy').find(([id]) => id.startsWith(prefix))![1].Properties.PolicyDocument;
    const actionsOf = (prefix: string) => fnPolicy(prefix).Statement.flatMap((s: any) => [s.Action].flat()).sort();
    expect(actionsOf('readerFnServiceRoleDefaultPolicy')).toEqual(['dynamodb:GetItem', 'dynamodb:Query']);
    expect(actionsOf('adminFnServiceRoleDefaultPolicy')).toEqual(['dynamodb:UpdateItem']);
  });
});

describe('Lambda and Cognito', () => {
  it('runs both functions on Node.js 24, arm64, with the table name from the environment', () => {
    const fns = resources('AWS::Lambda::Function').map(([, r]) => r.Properties).filter((p) => p.Handler === 'index.handler');
    expect(fns).toHaveLength(2);
    for (const f of fns) {
      expect(f).toMatchObject({ Runtime: 'nodejs24.x', Architectures: ['arm64'], Timeout: 10 });
      expect(f.Environment.Variables.ORDERS_TABLE).toEqual({ Ref: expect.stringMatching(/^Orders/) });
    }
  });

  it('gives each agent client only the client-credentials flow and its own scopes', () => {
    const clients = resources('AWS::Cognito::UserPoolClient').map(([id, r]) => [id, r.Properties] as const);
    expect(clients).toHaveLength(2);
    for (const [, c] of clients) {
      expect(c.AllowedOAuthFlows).toEqual(['client_credentials']);
      expect(c.GenerateSecret).toBe(true);
    }
    const scopes = Object.fromEntries(clients.map(([id, c]) => [id.replace(/[0-9A-F]{8}$/, ''), c.AllowedOAuthScopes]));
    expect(scopes.AgentPoolReaderAgent).toEqual(['orders/read']);
    expect(scopes.AgentPoolOpsAgent).toEqual(['orders/read', 'orders/admin']);
  });

  it('has no self sign-up', () => {
    expect(one('AWS::Cognito::UserPool').Properties.AdminCreateUserConfig).toEqual({ AllowAdminCreateUserOnly: true });
  });
});

describe('cdk-nag', () => {
  it('reports no unacknowledged AWS Solutions findings', () => {
    const app = new cdk.App({ outdir: fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-nag-')) });
    new OrdersMcpStack(app, 'Nag', { env });
    cdk.Validations.of(app).addPlugins(new AwsSolutionsChecks(app));
    const assembly = app.synth();
    const report = JSON.parse(fs.readFileSync(path.join(assembly.directory, 'validation-report.json'), 'utf8'));
    expect(report.pluginReports.length).toBeGreaterThan(0);
    for (const plugin of report.pluginReports) expect(plugin.violations).toEqual([]);
  });
});

test('synth stops with a clear message when the bundle is missing', () => {
  const backup = `${BUILD_DIR}.bak-${process.pid}`;
  fs.renameSync(BUILD_DIR, backup);
  try {
    expect(() => new OrdersMcpStack(new cdk.App(), 'NoBundle', { env })).toThrow('Run "npm run bundle" first');
  } finally {
    fs.renameSync(backup, BUILD_DIR);
  }
});
