/**
 * Adversarial requests against the real Cedar policies in infra/lib/policies.ts.
 *
 * The policy tests in test/infra check the Cedar text and the CloudFormation
 * template. These evaluate decisions: the same statements, with the gateway ARN
 * filled in, go through the Cedar authorizer (@cedar-policy/cedar-wasm) for
 * requests a hostile or confused caller might send.
 *
 * What this does not prove: AgentCore Policy runs its own engine and builds the
 * principal from the JWT. Here the principal is built by hand the way the AWS
 * docs describe it (every claim becomes a string tag), so a difference in how
 * AgentCore maps claims, or in its Cedar version, is outside this test.
 */
import { isAuthorized, type AuthorizationCall } from '@cedar-policy/cedar-wasm/nodejs';
import { ADMIN_TARGET, READ_TARGET, gatewayToolName } from '../../app/src/tools/definitions';
import { POLICIES } from '../../infra/lib/policies';

const GATEWAY_ARN = 'arn:aws:bedrock-agentcore:us-east-1:111122223333:gateway/orders-mcp-test';
const OTHER_GATEWAY_ARN = 'arn:aws:bedrock-agentcore:us-east-1:111122223333:gateway/someone-else';

const staticPolicies = Object.fromEntries(
  POLICIES.map((p) => [p.name, p.statement.split('${GatewayArn}').join(GATEWAY_ARN)]),
);

interface Ask {
  tool: string;
  scope?: string;
  principalType?: string;
  gatewayArn?: string;
}

function decide({ tool, scope, principalType = 'AgentCore::OAuthUser', gatewayArn = GATEWAY_ARN }: Ask) {
  const principal = { type: principalType, id: 'client-under-test' };
  const call: AuthorizationCall = {
    principal,
    action: { type: 'AgentCore::Action', id: tool },
    resource: { type: 'AgentCore::Gateway', id: gatewayArn },
    context: {},
    policies: { staticPolicies },
    entities: [
      {
        uid: principal,
        attrs: {},
        parents: [],
        tags: scope === undefined ? {} : { scope },
      },
    ],
  };
  const answer = isAuthorized(call);
  if (answer.type !== 'success') throw new Error(JSON.stringify(answer.errors));
  return { decision: answer.response.decision, errors: answer.response.diagnostics.errors };
}

const CANCEL = gatewayToolName(ADMIN_TARGET, 'cancel_order');
const GET = gatewayToolName(READ_TARGET, 'get_order');

describe('Cedar policies under adversarial requests', () => {
  it('control: an admin-scoped token may cancel', () => {
    expect(decide({ tool: CANCEL, scope: 'orders/read orders/admin' }).decision).toBe('allow');
  });

  it('control: a read-only token may read', () => {
    expect(decide({ tool: GET, scope: 'orders/read' }).decision).toBe('allow');
  });

  it('a read-only token asking for cancel_order is denied', () => {
    expect(decide({ tool: CANCEL, scope: 'orders/read' }).decision).toBe('deny');
  });

  it('a token with no scope claim is denied without an evaluation error', () => {
    const out = decide({ tool: CANCEL });
    expect(out.decision).toBe('deny');
    // hasTag before getTag: a missing tag is a plain deny, not an error.
    expect(out.errors).toEqual([]);
  });

  it('an empty scope string is denied', () => {
    expect(decide({ tool: CANCEL, scope: '' }).decision).toBe('deny');
  });

  it('a scope that only mentions "admin" without the resource server is denied', () => {
    expect(decide({ tool: CANCEL, scope: 'admin' }).decision).toBe('deny');
  });

  it('a tool the policies never name is denied by default', () => {
    expect(decide({ tool: gatewayToolName(ADMIN_TARGET, 'delete_order'), scope: 'orders/admin' }).decision).toBe('deny');
  });

  it('a read tool requested through the admin target name is denied', () => {
    expect(decide({ tool: gatewayToolName(ADMIN_TARGET, 'get_order'), scope: 'orders/admin' }).decision).toBe('deny');
  });

  it('the same request against a different gateway is denied', () => {
    expect(decide({ tool: CANCEL, scope: 'orders/admin', gatewayArn: OTHER_GATEWAY_ARN }).decision).toBe('deny');
  });

  it('a principal that is not an OAuth user is denied', () => {
    expect(decide({ tool: GET, scope: 'orders/read', principalType: 'AgentCore::IamEntity' }).decision).toBe('deny');
  });

  describe('known limit: `like` is a substring match on the whole scope string', () => {
    // These pass today and document the rule in infra/lib/policies.ts: no scope
    // name in the user pool may contain "orders/admin". The stack defines only
    // orders/read and orders/admin, so neither token below can be issued by it.
    // A second resource server whose identifier ends in "orders" could issue one.
    it('a lookalike scope that contains orders/admin is ALLOWED', () => {
      expect(decide({ tool: CANCEL, scope: 'orders/administrator' }).decision).toBe('allow');
    });

    it('a scope from another resource server ending in "orders" is ALLOWED', () => {
      expect(decide({ tool: CANCEL, scope: 'legacy-orders/admin' }).decision).toBe('allow');
    });
  });
});
