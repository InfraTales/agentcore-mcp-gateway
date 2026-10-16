# Existing Lambda functions as MCP tools with AgentCore Gateway

This repo takes two ordinary AWS Lambda functions from an order system and gives AI agents access to them as Model Context Protocol (MCP) tools. Amazon Bedrock AgentCore Gateway is the MCP server. Amazon Cognito issues each agent a token, and AgentCore Policy decides which agent may call the one tool that changes data.

It's written in AWS CDK (TypeScript). The tests run the official MCP TypeScript SDK client against a local MCP server built from the same tool definitions and handlers, and they run the real DynamoDB condition expressions against DynamoDB Local.

## What the agents get

| Tool name an agent sees | Lambda function | What it does |
|---|---|---|
| `orders-read___get_order` | reader | One order by ID |
| `orders-read___list_customer_orders` | reader | A customer's recent orders, newest first |
| `orders-admin___cancel_order` | admin | Cancels an OPEN order. Refuses shipped orders. Safe to retry |

The gateway names each tool `<target>___<tool>`, joining the two parts with `___`. Your function gets the full name and has to strip the prefix itself.

## How a tool call flows

1. The agent gets an access token from Cognito with the client-credentials flow. The reader agent's token carries `orders/read`. The ops agent's token also carries `orders/admin`.
2. The agent calls the gateway's `/mcp` URL with the token. The gateway checks the JWT against Cognito's discovery URL and the two allowed client IDs.
3. AgentCore Policy evaluates two Cedar policies. Read tools are open to any authenticated agent. `cancel_order` needs the `orders/admin` scope. The reader agent doesn't even see `cancel_order` in its tool list.
4. The gateway invokes the right Lambda function with its own IAM role. The tool arguments arrive as the event. The tool name and gateway IDs arrive in the client context.
5. The function validates the input, talks to DynamoDB and returns JSON.

## Layout

| Path | What's there |
|---|---|
| `app/src/tools/definitions.ts` | The tool contract, written once. CDK deploys it; the local server lists it |
| `app/src/tools/validate.ts` | Input checks, including the rules the gateway's schema subset can't express |
| `app/src/handlers/` | The two Lambda handlers and the gateway context parsing |
| `app/src/orders/` | DynamoDB access and the tool logic |
| `app/src/local/mcp-server.ts` | A local MCP server over Streamable HTTP, built from the same handlers |
| `infra/lib/orders-mcp-stack.ts` | The stack: table, functions, Cognito, gateway, targets, policy engine |
| `infra/lib/policies.ts` | The Cedar policies |

## Deploy

You need Node.js 24, AWS credentials and a CDK-bootstrapped account in a Region with AgentCore Gateway and Policy (us-east-1 is the default).

```bash
npm ci
npm run check            # type check, lint, tests, synth with cdk-nag
npm run deploy           # add -c domainPrefix=<unique> if the Cognito domain is taken
npm run seed             # three sample orders
npm run smoke            # tokens, JWT check, policy and tools, end to end
```

Want to watch policy decisions before they block anything? Deploy with `-c policyMode=LOG_ONLY`, check the logs, then deploy again without it.

## Tests

| Command | What runs | Needs |
|---|---|---|
| `npm test` | Unit, handler flow, MCP contract, CDK template, cdk-nag and bundle tests | Nothing |
| `npm run test:engine` | Condition expressions and the full MCP path against DynamoDB Local | Docker |
| `npm run smoke` | Checks against your deployed stack | A deploy |

To run the engine tests on your machine:

```bash
docker run -d --rm -p 8020:8000 amazon/dynamodb-local:3.3.2
AWS_ENDPOINT_URL_DYNAMODB=http://127.0.0.1:8020 npm run test:engine
```

We broke each safeguard on purpose once and confirmed a test failed (`npm run test:mutation`, with DynamoDB Local running). That run also turned up a condition clause that did nothing, so we removed it; the comment on `OrderStore.cancel` has the story.

To try the tools with an MCP client on your laptop:

```bash
ORDERS_TABLE=<table> AWS_ENDPOINT_URL_DYNAMODB=http://127.0.0.1:8020 npm run mcp:local
```

Then point MCP Inspector or any MCP client at `http://127.0.0.1:3333/mcp`. The local server has no JWT check and no policy. Those only exist in AWS.

## Cost

AgentCore Gateway, AgentCore Policy and Cognito machine-to-machine tokens have no free tier. At 100,000 MCP operations a month the stack costs about $6 before credits, and most of that is tokens and policy checks. If your agents fetch a new token for every session, the token line alone can pass $50, so [docs/cost.md](docs/cost.md) shows the math and the fix.

## More docs

- [docs/security.md](docs/security.md): the auth layers and what each one stops
- [docs/cost.md](docs/cost.md): prices, a worked month, and the token trap
- [docs/runbook.md](docs/runbook.md): what to check when a tool call fails

## Clean up

```bash
npm run destroy
```

The stack deletes the table, user pool and log groups with it, because they hold sample data only. Change their removal policies before you use real data.

---

Created by Rahul Ladumor / InfraTales, under the MIT-0 license
