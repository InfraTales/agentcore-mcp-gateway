# Contributing

Thanks for helping. This repo shows how to put existing Lambda functions behind AgentCore Gateway as MCP tools, so every change has to keep the tool contract and its tests in step.

## Setup

You need Node.js 24 and npm. Docker is only needed for the engine tests.

```bash
npm ci
npm run check
docker run -d --rm -p 8020:8000 amazon/dynamodb-local:3.3.2
AWS_ENDPOINT_URL_DYNAMODB=http://127.0.0.1:8020 npm run test:engine
```

## Adding a tool

1. Add its definition to `app/src/tools/definitions.ts`. Use only `type`, `description`, `properties`, `required` and `items` in the schema. The gateway doesn't take other JSON Schema keywords, and a test enforces that.
2. Put any extra input rules (formats, lengths, ranges) in `app/src/tools/validate.ts`.
3. Write the logic in `app/src/orders/tools.ts` and register it in the handler's tool map.
4. Decide who may call it, and add or change a Cedar policy in `infra/lib/policies.ts`. The policy engine denies by default, so a tool with no policy can't be called.
5. Add a contract test in `test/mcp` and, if it touches DynamoDB, an engine test.

## What a change needs

- A test that fails without it. For a bug, write the failing test first. For a safeguard, add it to `scripts/mutation-check.mjs` and check that the run says CAUGHT.
- No tool arguments in logs: they can hold customer data.
- A written reason for any cdk-nag acknowledgement, scoped to the construct it's about.
- Docs updated when behaviour changes.

## Pull requests

Branch from `main`, keep each pull request to one change, and say why in the description. CI must pass before merge.

Found a security problem? Don't open a public issue. [SECURITY.md](SECURITY.md) says where to send it.

---

Created by Rahul Ladumor / InfraTales
