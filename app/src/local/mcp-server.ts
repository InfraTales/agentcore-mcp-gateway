/**
 * A local MCP server built from the same tool definitions and the same Lambda
 * handlers that AgentCore Gateway calls in AWS.
 *
 * It lists tools with the gateway's naming (`orders-read___get_order`) and the
 * exact schemas the CDK stack deploys. For each tool call it builds the client
 * context the gateway sends and invokes the real handler. If a schema, a tool
 * name or a handler drifts, an MCP client test against this server fails.
 *
 * What it does not copy: the gateway's inbound JWT check and AgentCore Policy.
 * Those run in AWS only. The smoke test covers them after a deploy.
 */
import { createServer, type Server as HttpServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { adminTools } from '../handlers/admin';
import { makeHandler, type ToolFn } from '../handlers/dispatch';
import { readerTools } from '../handlers/reader';
import { isToolError } from '../handlers/result';
import type { Orders } from '../orders/store';
import { ADMIN_TARGET, ADMIN_TOOLS, gatewayToolName, READ_TARGET, READ_TOOLS, TOOL_NAME_DELIMITER, type ToolDefinition } from '../tools/definitions';

interface Target {
  name: string;
  definitions: readonly ToolDefinition[];
  tools: Readonly<Record<string, ToolFn>>;
}

export const TARGETS: readonly Target[] = [
  { name: READ_TARGET, definitions: READ_TOOLS, tools: readerTools },
  { name: ADMIN_TARGET, definitions: ADMIN_TOOLS, tools: adminTools },
];

export function createMcpServer(store: Orders): Server {
  const server = new Server({ name: 'orders-local-gateway', version: '1.0.0' }, { capabilities: { tools: {} } });
  const handlers = new Map(TARGETS.map((t) => [t.name, makeHandler(t.tools, () => store)]));

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TARGETS.flatMap((t) =>
      t.definitions.map((d) => ({ name: gatewayToolName(t.name, d.name), description: d.description, inputSchema: d.inputSchema })),
    ),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const fullName = req.params.name;
    const targetName = fullName.split(TOOL_NAME_DELIMITER)[0] ?? '';
    const handler = handlers.get(targetName);
    if (!handler) return { isError: true, content: [{ type: 'text', text: `unknown tool ${fullName}` }] };
    const result = await handler(req.params.arguments ?? {}, {
      awsRequestId: 'local',
      clientContext: { custom: { bedrockAgentCoreToolName: fullName, bedrockAgentCoreGatewayId: 'local' } } as never,
    });
    return { isError: isToolError(result), content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  return server;
}

/** Streamable HTTP on `/mcp`, stateless, the same transport and path the gateway serves. */
export function startHttpServer(store: Orders, port = 0, host = '127.0.0.1'): Promise<HttpServer> {
  const http = createServer((req, res) => {
    if (req.url !== '/mcp') {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: unknown;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        res.writeHead(400).end();
        return;
      }
      // Stateless: a fresh server and transport per request, no session IDs.
      const server = createMcpServer(store);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      server
        .connect(transport)
        .then(() => transport.handleRequest(req, res, body))
        .catch((err: unknown) => {
          console.error(err);
          if (!res.headersSent) res.writeHead(500).end();
        });
    });
  });
  return new Promise((resolve) => http.listen(port, host, () => resolve(http)));
}
