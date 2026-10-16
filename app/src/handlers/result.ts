/**
 * Every tool returns a JSON object. Failures the agent can act on (bad input,
 * unknown order, an order that can't be cancelled) come back as `{ error }` with
 * a stable code, so the model can read them and try something else. Anything
 * unexpected is thrown and shows up as a Lambda error and in the logs.
 */
export type ToolErrorCode = 'INVALID_INPUT' | 'NOT_FOUND' | 'NOT_CANCELLABLE' | 'UNKNOWN_TOOL' | 'NOT_A_GATEWAY_CALL';

export interface ToolError {
  error: { code: ToolErrorCode; message: string };
}

export function toolError(code: ToolErrorCode, message: string): ToolError {
  return { error: { code, message } };
}

export function isToolError(value: unknown): value is ToolError {
  return typeof value === 'object' && value !== null && 'error' in value;
}
