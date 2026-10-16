/**
 * What AgentCore Gateway puts in the Lambda context.
 *
 * The gateway passes the tool arguments as the event, and its own metadata in
 * the client context: the gateway ID, target ID, request IDs and the tool name.
 * The tool name arrives as `<target name>___<tool name>`, so the handler strips
 * everything up to the first `___` to find which tool was called.
 */
import type { Context } from 'aws-lambda';
import { TOOL_NAME_DELIMITER } from '../tools/definitions';

export interface GatewayMetadata {
  toolName: string;
  fullToolName: string;
  gatewayId?: string;
  targetId?: string;
  awsRequestId?: string;
  mcpMessageId?: string;
}

type CustomContext = Record<string, unknown>;

function customOf(context: Pick<Context, 'clientContext'>): CustomContext | undefined {
  // The Node.js runtime hands over the client context JSON as sent. AWS documents
  // the key as `custom`; @types/aws-lambda types it as `Custom`. Accept either.
  const cc = context.clientContext as unknown as { custom?: CustomContext; Custom?: CustomContext } | undefined;
  return cc?.custom ?? cc?.Custom;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Returns undefined when the call didn't come through a gateway. */
export function gatewayMetadata(context: Pick<Context, 'clientContext'>): GatewayMetadata | undefined {
  const custom = customOf(context);
  const fullToolName = str(custom?.bedrockAgentCoreToolName);
  if (!custom || !fullToolName) return undefined;
  const at = fullToolName.indexOf(TOOL_NAME_DELIMITER);
  const toolName = at === -1 ? fullToolName : fullToolName.slice(at + TOOL_NAME_DELIMITER.length);
  return {
    toolName,
    fullToolName,
    gatewayId: str(custom.bedrockAgentCoreGatewayId),
    targetId: str(custom.bedrockAgentCoreTargetId),
    awsRequestId: str(custom.bedrockAgentCoreAwsRequestId),
    mcpMessageId: str(custom.bedrockAgentCoreMcpMessageId),
  };
}
