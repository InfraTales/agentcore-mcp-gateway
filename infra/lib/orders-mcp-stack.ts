import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { CUSTOMER_INDEX } from '../../app/src/orders/store';
import { ADMIN_TARGET, ADMIN_TOOLS, READ_TARGET, READ_TOOLS, type ToolDefinition } from '../../app/src/tools/definitions';
import { ADMIN_SCOPE, POLICIES, READ_SCOPE } from './policies';


/**
 * MCP versions the gateway advertises. 2025-03-26 must stay: it is the version the gateway
 * assumes when a request has no MCP-Protocol-Version header.
 */
export const MCP_PROTOCOL_VERSIONS = ['2025-03-26', '2025-06-18', '2025-11-25'] as const;

export interface OrdersMcpStackProps extends cdk.StackProps {
  /** Cognito hosted domain prefix. Must be unique in the Region. */
  readonly domainPrefix?: string;
  /** Policy engine mode. Start with LOG_ONLY to watch decisions, then ENFORCE. */
  readonly policyMode?: 'ENFORCE' | 'LOG_ONLY';
}

export const BUILD_DIR = path.join(__dirname, '..', '..', 'build');

/** The gateway's tool schema type wants mutable arrays; our definitions are readonly. */
function toolSchema(tools: readonly ToolDefinition[]): agentcore.CfnGatewayTarget.ToolSchemaProperty {
  return { inlinePayload: JSON.parse(JSON.stringify(tools)) as agentcore.CfnGatewayTarget.ToolDefinitionProperty[] };
}

export class OrdersMcpStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: OrdersMcpStackProps = {}) {
    super(scope, id, props);
    for (const name of ['reader', 'admin']) {
      if (!fs.existsSync(path.join(BUILD_DIR, name, 'index.js'))) throw new Error(`build/${name}/index.js is missing. Run "npm run bundle" first.`);
    }

    // --- The existing backend: one table, two Lambda functions -------------------------

    const table = new dynamodb.Table(this, 'Orders', {
      partitionKey: { name: 'orderId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      // Sample data only. Change to RETAIN before you put real orders in it.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    table.addGlobalSecondaryIndex({
      indexName: CUSTOMER_INDEX,
      partitionKey: { name: 'customerId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    const fn = (name: 'reader' | 'admin', description: string) => {
      const logGroup = new logs.LogGroup(this, `${name}Logs`, {
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
      return new lambda.Function(this, `${name}Fn`, {
        description,
        runtime: lambda.Runtime.NODEJS_24_X,
        architecture: lambda.Architecture.ARM_64,
        handler: 'index.handler',
        code: lambda.Code.fromAsset(path.join(BUILD_DIR, name)),
        memorySize: 256,
        timeout: cdk.Duration.seconds(10),
        logGroup,
        environment: { ORDERS_TABLE: table.tableName, NODE_OPTIONS: '--enable-source-maps' },
      });
    };
    const reader = fn('reader', 'MCP tools get_order and list_customer_orders (read only)');
    const admin = fn('admin', 'MCP tool cancel_order (destructive)');

    // Least privilege per function: the reader can't write, the admin can't read.
    reader.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:Query'],
        resources: [table.tableArn, `${table.tableArn}/index/${CUSTOMER_INDEX}`],
      }),
    );
    admin.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:UpdateItem'], resources: [table.tableArn] }));

    // --- Inbound auth: Amazon Cognito, machine-to-machine ---------------------------------

    const userPool = new cognito.UserPool(this, 'AgentPool', {
      selfSignUpEnabled: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const domain = userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: props.domainPrefix ?? `orders-mcp-${this.account}` },
    });
    const ordersApi = new cognito.UserPoolResourceServer(this, 'OrdersApi', {
      userPool,
      identifier: 'orders',
      scopes: [
        { scopeName: 'read', scopeDescription: 'Read orders' },
        { scopeName: 'admin', scopeDescription: 'Cancel orders' },
      ],
    });
    const scopeOf = (name: string) => cognito.OAuthScope.custom(name);
    const client = (id: string, scopes: string[]) =>
      userPool.addClient(id, {
        generateSecret: true,
        authFlows: {},
        oAuth: { flows: { clientCredentials: true }, scopes: scopes.map(scopeOf) },
        accessTokenValidity: cdk.Duration.minutes(60),
      });
    // Two agents: one can only look things up, the other may also cancel.
    const readerClient = client('ReaderAgent', [READ_SCOPE]);
    const opsClient = client('OpsAgent', [READ_SCOPE, ADMIN_SCOPE]);
    readerClient.node.addDependency(ordersApi);
    opsClient.node.addDependency(ordersApi);

    // --- AgentCore Policy ------------------------------------------------------------------

    const policyEngine = new agentcore.CfnPolicyEngine(this, 'PolicyEngine', {
      name: 'orders_mcp_policies',
      description: 'Decides which agent may call which order tool.',
    });

    // --- Gateway role: what the gateway may do on our behalf -----------------------------

    const gatewayRole = new iam.Role(this, 'GatewayRole', {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com', {
        conditions: {
          StringEquals: { 'aws:SourceAccount': this.account },
          ArnLike: { 'aws:SourceArn': `arn:${this.partition}:bedrock-agentcore:${this.region}:${this.account}:gateway/*` },
        },
      }),
      description: 'Assumed by the AgentCore gateway to invoke the order tools and ask the policy engine.',
    });
    gatewayRole.addToPolicy(
      new iam.PolicyStatement({ actions: ['lambda:InvokeFunction'], resources: [reader.functionArn, admin.functionArn] }),
    );
    gatewayRole.addToPolicy(
      new iam.PolicyStatement({ actions: ['bedrock-agentcore:GetPolicyEngine'], resources: [policyEngine.attrPolicyEngineArn] }),
    );
    const gatewayArnPattern = `arn:${this.partition}:bedrock-agentcore:${this.region}:${this.account}:gateway/*`;
    const authzStatement = new iam.PolicyStatement({
      actions: ['bedrock-agentcore:AuthorizeAction', 'bedrock-agentcore:PartiallyAuthorizeActions'],
      // The gateway ID doesn't exist until the gateway does, and the gateway needs
      // this role first, so the gateway half is a pattern for this account and Region.
      resources: [policyEngine.attrPolicyEngineArn, gatewayArnPattern],
    });
    gatewayRole.addToPolicy(authzStatement);

    // --- The gateway -----------------------------------------------------------------------

    const gateway = new agentcore.CfnGateway(this, 'Gateway', {
      name: 'orders-mcp',
      description: 'Order tools for agents, backed by existing Lambda functions.',
      protocolType: 'MCP',
      // A request without an MCP-Protocol-Version header is treated as 2025-03-26, and the
      // gateway rejects it if that version isn't listed. MCP clients send initialize before they
      // know a version, so the official TypeScript SDK's first request has no header.
      protocolConfiguration: { mcp: { supportedVersions: [...MCP_PROTOCOL_VERSIONS] } },
      authorizerType: 'CUSTOM_JWT',
      authorizerConfiguration: {
        customJwtAuthorizer: {
          discoveryUrl: `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}/.well-known/openid-configuration`,
          // Cognito access tokens only carry aud when you request a resource binding.
          // client_id is always there, so check the client.
          allowedClients: [readerClient.userPoolClientId, opsClient.userPoolClientId],
        },
      },
      roleArn: gatewayRole.roleArn,
      policyEngineConfiguration: { arn: policyEngine.attrPolicyEngineArn, mode: props.policyMode ?? 'ENFORCE' },
    });
    // CloudFormation must create the role's permissions before the gateway uses them.
    gateway.node.addDependency(gatewayRole);

    const target = (id: string, name: string, fnArn: string, tools: readonly ToolDefinition[]) =>
      new agentcore.CfnGatewayTarget(this, id, {
        gatewayIdentifier: gateway.attrGatewayIdentifier,
        name,
        targetConfiguration: { mcp: { lambda: { lambdaArn: fnArn, toolSchema: toolSchema(tools) } } },
        credentialProviderConfigurations: [{ credentialProviderType: 'GATEWAY_IAM_ROLE' }],
      });
    const readTarget = target('ReadTarget', READ_TARGET, reader.functionArn, READ_TOOLS);
    const adminTarget = target('AdminTarget', ADMIN_TARGET, admin.functionArn, ADMIN_TOOLS);

    // Policy creation checks each action against the gateway's tools, so targets come first.
    for (const p of POLICIES) {
      const policy = new agentcore.CfnPolicy(this, `Policy-${p.name}`, {
        policyEngineId: policyEngine.attrPolicyEngineId,
        name: p.name,
        description: p.description,
        definition: { cedar: { statement: cdk.Fn.sub(p.statement, { GatewayArn: gateway.attrGatewayArn }) } },
        validationMode: 'FAIL_ON_ANY_FINDINGS',
      });
      policy.addResourceDependency(readTarget);
      policy.addResourceDependency(adminTarget);
    }

    // --- Outputs ---------------------------------------------------------------------------

    new cdk.CfnOutput(this, 'GatewayUrl', { value: gateway.attrGatewayUrl });
    new cdk.CfnOutput(this, 'TokenUrl', { value: `${domain.baseUrl()}/oauth2/token` });
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'ReaderClientId', { value: readerClient.userPoolClientId });
    new cdk.CfnOutput(this, 'OpsClientId', { value: opsClient.userPoolClientId });
    new cdk.CfnOutput(this, 'OrdersTable', { value: table.tableName });

    this.acknowledgeFindings(userPool, [reader, admin], gatewayRole);
  }

  /** Every cdk-nag finding we accept, scoped to its construct, each with its reason. */
  private acknowledgeFindings(userPool: cognito.UserPool, fns: lambda.Function[], gatewayRole: iam.Role): void {
    const ack = (scope: Construct, id: string, reason: string) => cdk.Validations.of(scope).acknowledge({ id, reason });

    const noHumans = 'No human users sign in to this pool. It only issues client-credentials tokens to two agent app clients.';
    ack(userPool, 'AwsSolutions::AwsSolutions-COG1', `${noHumans} There are no passwords, so a password policy protects nothing.`);
    ack(userPool, 'AwsSolutions::AwsSolutions-COG2', `${noHumans} MFA applies to user sign-in, which this pool doesn't have.`);
    ack(userPool, 'AwsSolutions::AwsSolutions-COG8', `${noHumans} The Plus plan's threat protection covers user sign-in, and it costs extra per MAU.`);

    for (const f of fns) {
      ack(
        f.role!,
        'AwsSolutions::AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]',
        'AWSLambdaBasicExecutionRole only allows writing to CloudWatch Logs, which every function needs.',
      );
    }

    // cdk-nag prints the Region and account as the template has them: a placeholder
    // when unresolved, the literal value when the stack has a concrete environment.
    const region = cdk.Token.isUnresolved(this.region) ? '<AWS::Region>' : this.region;
    const account = cdk.Token.isUnresolved(this.account) ? '<AWS::AccountId>' : this.account;
    const partition = cdk.Token.isUnresolved(this.partition) ? '<AWS::Partition>' : this.partition;
    ack(
      gatewayRole,
      `AwsSolutions::AwsSolutions-IAM5[Resource::arn:${partition}:bedrock-agentcore:${region}:${account}:gateway/*]`,
      'AgentCore authorization actions need the gateway ARN, which only exists after the gateway is created with this role. The pattern covers gateways in this account and Region only, and the policy engine half is exact.',
    );
  }
}
