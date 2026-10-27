# Adversarial tests

`test/adversarial/` sends the requests a hostile or confused caller might send and checks what the deterministic layer does with them: input validation, the Lambda handlers, tool routing and the Cedar policies. Run them with the rest of the unit tests:

```bash
npm test
# or only this suite
npx jest test/adversarial
```

## Why test this layer

An agent that has read an injected instruction (in a ticket, a web page, a tool result) can only act on it through tool calls. OWASP LLM01:2025 Prompt Injection calls this indirect prompt injection, and MITRE ATLAS lists it as AML.T0051.001 and the data-exfiltration variant through a write tool as AML.T0086. OWASP LLM06:2025 Excessive Agency recommends complete mediation: authorization in downstream systems rather than in the model. These tests check that downstream layer.

## What each group attacks

| Group | File | What it sends | What must happen |
|---|---|---|---|
| Injected text in arguments | `tool-input.adversarial.test.ts` | Instructions appended to an order ID, newlines, wildcards, lookalike Unicode digits, oversized IDs, arrays and objects in place of an ID, undeclared fields such as `approved: true`, a `__proto__` key, out-of-range `limit` values | `INVALID_INPUT`, and no order changes |
| Free text the rules cannot judge | same | An instruction inside the `cancel_order` reason | The cancel is stored as data. No read tool returns the reason, so the text never reaches another model's context through this server |
| Business rules | same | Cancel a shipped order with an "override" reason; cancel twice | `NOT_CANCELLABLE`; the second cancel changes nothing |
| Tool routing | same | `cancel_order` sent to the read function, `constructor` and `__proto__` as tool names, a doubled `___` delimiter, a direct invoke without the gateway context | `UNKNOWN_TOOL` or `NOT_A_GATEWAY_CALL`, before any tool runs |
| Cedar decisions | `policies.adversarial.test.ts` | A read-only token asking for `cancel_order`, no scope claim, an empty scope, `admin` without the resource server, an unknown tool, a read tool through the admin target, another gateway ARN, a non-OAuth principal | `deny`, with no evaluation error |

The policy tests run the statements from `infra/lib/policies.ts` through the Cedar authorizer in `@cedar-policy/cedar-wasm`, with the gateway ARN filled in. The tests in `test/infra` check the Cedar text and the template; these check decisions.

## Known limits these tests document

Two groups pass today because they describe behaviour to know about, not behaviour to celebrate:

1. **`like` is a substring match on the whole scope string.** A token whose scope contains `orders/admin` anywhere, such as `orders/administrator` or `legacy-orders/admin`, is allowed to cancel. This stack's user pool defines only `orders/read` and `orders/admin`, so it cannot issue such a token. A second resource server whose identifier ends in `orders` could. The rule in `policies.ts` stands: no scope name in the pool may contain another.
2. **The tools do not know the end customer.** The gateway authorizes the calling agent through client credentials. The tools receive no customer identity, so any agent allowed to read can read any customer's orders, and an injected instruction that names another customer's order ID is not stopped here. Closing that needs the end user's identity in the call.

## Mutants

`scripts/mutation-check.mjs` has four mutants for this suite. Each one breaks a safeguard once, and the adversarial tests must fail:

| Mutant | Caught by |
|---|---|
| Order ID pattern not anchored at the end | the injected-ID cases |
| Cancel reason handed back to readers | the free-text case |
| Scope tag read without `hasTag` | the missing-scope case (evaluation error) |
| Cancel policy matches any `admin` scope | the `admin`-without-resource-server case |

The first two survive the other 61 unit, contract and infrastructure tests. Only this suite catches them.

## What this does not prove

- No model is in the loop. These tests say what happens to a tool call once a model writes it, not how often a model can be talked into writing it.
- Nothing here is deployed. AgentCore Policy runs its own engine and builds the principal from the JWT. The tests build the principal the way the AWS docs describe it (every claim becomes a string tag), so a difference in AgentCore's claim mapping or Cedar version is outside them.
- Passing these tests is not a security assessment of any system that copies this code.
