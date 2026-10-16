# Security

An agent that can cancel orders is a risk, so this stack checks every call in four places. Each layer stops something the others can't.

## 1. The caller: the gateway's JWT check

The gateway uses `CUSTOM_JWT` inbound auth. It reads Cognito's OpenID discovery document, checks each access token's signature and expiry, and only accepts tokens whose `client_id` is one of the two agent app clients.

We check `allowedClients`, not `allowedAudience`. Cognito access tokens carry a `client_id` claim but no `aud` claim, so an audience check would reject every token.

The user pool has no self sign-up and no human users. Each agent app client uses the client-credentials flow with a secret. That's why we acknowledged cdk-nag's password, MFA and threat-protection rules, and wrote the reason next to each one.

## 2. The tools it may call: AgentCore Policy

The policy engine runs in `ENFORCE` mode and denies by default. Two Cedar policies open it up:

- `allow_read_tools` lets any authenticated agent call `get_order` and `list_customer_orders`.
- `allow_cancel_for_admin_scope` lets an agent call `cancel_order` only when its token's `scope` claim contains `orders/admin`.

Policy also filters the tool list, so `cancel_order` doesn't appear in the reader agent's list at all. Nobody can talk a model into calling a tool it doesn't know about, and if it guesses the name, the engine still denies the call.

Three rules to keep in mind when you edit the policies:

- Every JWT claim becomes a string tag. Check `hasTag` before `getTag`, because reading a missing tag is an error, and errors deny.
- `like "*orders/admin*"` matches anywhere in the space-separated scope string. Never add a scope whose name contains another one, such as `orders/administrator`.
- A policy that names a specific action must name a specific gateway ARN. The stack fills it in with `Fn::Sub`.

Start new policies with `-c policyMode=LOG_ONLY`. The engine logs what it would decide without blocking anything.

## 3. The gateway's reach: its IAM role

The role trusts `bedrock-agentcore.amazonaws.com` only for gateways in this account and Region. It may invoke the two tool functions, read its policy engine, and call `AuthorizeAction` and `PartiallyAuthorizeActions`. Those two need the gateway's ARN, and CloudFormation only knows it after it creates the gateway with this role. So the gateway half of that statement is a pattern for this account and Region, and the cdk-nag acknowledgement says why.

## 4. The function's own checks: input and conditions

The gateway's tool schema only knows types, required fields and nesting. Each handler checks the rest: ID formats, reason length, list limits and unknown fields. Anything IAM allows can invoke a Lambda function, so the handler doesn't trust that the caller checked.

Cancelling uses a DynamoDB condition, `#s = :open`. Two agents racing to cancel one order get one cancel and one "already cancelled". A stale read can't cancel a shipped order either, and the engine tests prove both against DynamoDB Local.

The reader function's role can only `GetItem` and `Query`. The admin function's role can only `UpdateItem`.

## What we chose not to add

- **A KMS customer managed key** for the gateway and policy engine. Both support one through `kmsKeyArn`. AWS-owned encryption is enough for sample data, and a key costs $1 a month.
- **AWS WAF** in front of the gateway. Add it if the gateway faces untrusted networks at volume.
- **`DEBUG` exception level.** It returns internal error detail to the agent. A test keeps it off.
