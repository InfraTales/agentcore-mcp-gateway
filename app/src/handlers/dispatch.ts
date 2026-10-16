/**
 * Shared dispatch for gateway-invoked Lambda functions: read the tool name from
 * the client context, run the matching tool, log one line per call.
 */
import type { Context } from 'aws-lambda';
import type { Orders } from '../orders/store';
import type { ToolOutput } from '../orders/tools';
import { gatewayMetadata } from './gateway-context';
import { isToolError, toolError } from './result';

export type ToolFn = (store: Orders, input: unknown) => Promise<ToolOutput>;

export function makeHandler(tools: Readonly<Record<string, ToolFn>>, getStore: () => Orders) {
  return async (event: unknown, context: Pick<Context, 'clientContext' | 'awsRequestId'>): Promise<ToolOutput> => {
    const meta = gatewayMetadata(context);
    if (!meta) return toolError('NOT_A_GATEWAY_CALL', 'expected an AgentCore Gateway tool call');
    // Object.hasOwn, so a tool name like "constructor" can't reach Object.prototype.
    const tool = Object.hasOwn(tools, meta.toolName) ? tools[meta.toolName] : undefined;
    const started = Date.now();
    const result = tool ? await tool(getStore(), event ?? {}) : toolError('UNKNOWN_TOOL', `unknown tool ${meta.toolName}`);
    // Log the call, not the arguments: tool input can hold customer data.
    console.log(
      JSON.stringify({
        msg: 'tool call',
        tool: meta.fullToolName,
        gatewayId: meta.gatewayId,
        gatewayRequestId: meta.awsRequestId,
        lambdaRequestId: context.awsRequestId,
        ok: !isToolError(result),
        errorCode: isToolError(result) ? result.error.code : undefined,
        ms: Date.now() - started,
      }),
    );
    return result;
  };
}

/** One store per execution environment, created on first use. */
export function lazyStore(create: () => Orders): () => Orders {
  let store: Orders | undefined;
  return () => (store ??= create());
}
