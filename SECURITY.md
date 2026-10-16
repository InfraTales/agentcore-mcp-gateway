# Security policy

## Reporting a problem

Please don't report security problems in public GitHub issues. Use GitHub's private vulnerability reporting on this repository (Security tab, then "Report a vulnerability").

It helps to include the file and line or the commit, the steps to reproduce, and what an attacker could do with it.

## How this stack protects itself

[docs/security.md](docs/security.md) has the details and the reasons.

- The gateway accepts only Cognito access tokens issued to its two agent app clients.
- AgentCore Policy denies by default. Only tokens with the `orders/admin` scope may cancel orders.
- The gateway's IAM role can invoke the two tool functions and ask its policy engine, nothing else.
- The reader function can only read the table. The admin function can only update it.
- Every tool validates its own input, and cancelling uses a DynamoDB condition, so a stale or repeated call can't cancel a shipped order.
