# What this stack costs

Prices are us-east-1, checked on 2026-10-16. Gateway, Lambda, Cognito and DynamoDB prices come from the AWS Price List API offer files. The AgentCore Policy price comes from the AgentCore pricing page, because the offer file has no Policy line yet.

## The prices that matter

| Item | Price | Free allowance |
|---|---|---|
| Gateway MCP operations (ListTools, InvokeTool, Ping) | $0.005 per 1,000 | None |
| Gateway semantic search calls | $0.025 per 1,000 | None. This stack doesn't turn search on |
| Gateway tool indexing, for semantic search | $0.02 per 100 tools a month | None |
| AgentCore Policy authorization requests | $0.025 per 1,000 | None |
| Cognito machine-to-machine token requests | $2.25 per 1,000 (first 250,000) | None. App clients cost nothing |
| Lambda arm64 | $0.20 per million requests, $0.0000133334 per GB-second | 1 million requests and 400,000 GB-seconds a month |
| DynamoDB on-demand | $0.125 per million reads, $0.625 per million writes | 25 GB of storage |

AgentCore Identity costs nothing extra when it's used through the gateway.

## A worked month

Say 25,000 agent sessions a month. Each session lists tools once and makes three tool calls, for 60,000 reads and 15,000 cancels in total, so the gateway sees 100,000 MCP operations.

| Line | Math | Monthly |
|---|---|---|
| Gateway operations | 100,000 x $0.000005 | $0.50 |
| Policy checks | Up to 100,000 x $0.000025 | $2.50 |
| Cognito tokens, cached for their 60-minute life | 2 agents x 24 x 30 = 1,440 x $0.00225 | $3.24 |
| Lambda, before the free tier | 75,000 requests, 50 ms each at 256 MB | $0.03 |
| DynamoDB | 60,000 reads, 30,000 write units (the index doubles each cancel) | $0.03 |
| **Total** | | **About $6.30** |

Two assumptions sit in that table. We count tool lists as policy checks too, which makes $2.50 an upper bound; AWS's pricing page doesn't say whether it bills list filtering. And 50 ms per Lambda call is a guess: we didn't measure it in AWS. The Lambda free tier covers that line either way.

## The token trap

Cognito charges for every machine-to-machine token request, with no free tier. If each agent session asks for a new token instead of reusing one, the same month needs 25,000 tokens: $56.25. That's about 18 times the other lines combined ($3.06), and it takes the month from $6.30 to about $59. Cache the token and refresh it a few minutes before it expires.

## What would change the numbers

- Semantic search adds $0.025 per 1,000 search calls. You can only turn it on when you create the gateway.
- Tool indexing is $0.0002 per tool a month. AWS ties it to semantic search, which this stack leaves off; if you turn search on, three tools add $0.0006.
- Real traffic brings log volume, retries and larger items, which all add a little. Check Cost Explorer after the first week.
