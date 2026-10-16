/**
 * AgentCore Policy statements (Cedar), as Fn::Sub templates.
 *
 * Rules worth knowing before you edit these:
 * - The engine denies by default. A tool call goes through only when a permit
 *   matches and no forbid does. An engine with no policies blocks every call.
 * - Naming a specific action requires naming a specific gateway ARN, so each
 *   statement carries `${GatewayArn}`, filled in by CloudFormation.
 * - The action name is the gateway tool name: `<target>___<tool>`.
 * - Every JWT claim becomes a string tag on the principal. Check `hasTag`
 *   before `getTag`: reading a missing tag is an error, and errors deny.
 * - `like` is a wildcard match on the whole space-separated scope string, so no
 *   scope name may contain another as a substring (orders/admin vs orders/administrator).
 */
import { ADMIN_TARGET, cancelOrder, gatewayToolName, READ_TARGET, READ_TOOLS } from '../../app/src/tools/definitions';

export const ADMIN_SCOPE = 'orders/admin';
export const READ_SCOPE = 'orders/read';

export interface PolicyTemplate {
  name: string;
  description: string;
  /** Cedar text with `${GatewayArn}` placeholders for Fn::Sub. */
  statement: string;
}

const readActions = READ_TOOLS.map((t) => `AgentCore::Action::"${gatewayToolName(READ_TARGET, t.name)}"`).join(',\n    ');

export const POLICIES: readonly PolicyTemplate[] = [
  {
    name: 'allow_read_tools',
    description: 'Any caller the gateway authenticated may use the read-only order tools.',
    statement: `permit(
  principal is AgentCore::OAuthUser,
  action in [
    ${readActions}
  ],
  resource == AgentCore::Gateway::"\${GatewayArn}"
);`,
  },
  {
    name: 'allow_cancel_for_admin_scope',
    description: `Only tokens that carry the ${ADMIN_SCOPE} scope may cancel orders.`,
    statement: `permit(
  principal is AgentCore::OAuthUser,
  action == AgentCore::Action::"${gatewayToolName(ADMIN_TARGET, cancelOrder.name)}",
  resource == AgentCore::Gateway::"\${GatewayArn}"
)
when {
  principal.hasTag("scope") &&
  principal.getTag("scope") like "*${ADMIN_SCOPE}*"
};`,
  },
];
