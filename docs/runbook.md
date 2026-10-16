# Runbook

## A tool call fails

1. 401 from the gateway: the token is missing, expired or from another client. Check that the agent sends `Authorization: Bearer <access token>` and that its client ID is in the gateway's allowed clients.
2. The tool is missing from the agent's tool list: policy hides tools the agent may not call. Check the token's `scope` claim, then the policies in `infra/lib/policies.ts`.
3. The engine denies every call, even with permit policies: the gateway role is missing `GetPolicyEngine`, `AuthorizeAction` or `PartiallyAuthorizeActions`. The stack grants all three; check whether someone edited the role.
4. A policy is stuck in `CREATE_FAILED` with "Insufficient permissions to call gateway": the identity that created the policy needs `bedrock-agentcore:InvokeGateway` on the gateway. CDK's default deploy role has it.
5. The call reaches Lambda and returns `{ error }`: that's a tool-level answer such as `NOT_FOUND` or `NOT_CANCELLABLE`. The function's log has one line per call with the tool, gateway ID, request IDs and the error code.

## Find a call in the logs

Each function writes one JSON line per tool call to its log group. Search by `gatewayRequestId` to follow one call:

```bash
aws logs filter-log-events --log-group-name <AdminFn log group> --filter-pattern '{ $.errorCode = "NOT_CANCELLABLE" }'
```

Tool arguments are not logged, because they can hold customer data.

## Roll out a new policy

1. Deploy with `-c policyMode=LOG_ONLY`.
2. Run the smoke test and real traffic for a while, and read the policy decisions in the logs.
3. Deploy again without the flag to go back to `ENFORCE`.
