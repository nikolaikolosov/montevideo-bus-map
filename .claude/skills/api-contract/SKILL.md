---
name: api-contract
description: Author the API contracts (OpenAPI/GraphQL) from user flows and the data model - contract-first, with conventions, errors, and examples. Phase 2 interface core skill.
---

# /api-contract

Owner: **api-designer**; reviewed by **backend-lead** (implementability) and **frontend-lead**
(consumability).

## Sequence
1. Inputs: `design/user-flows.md` (named operations per flow) and `architecture/data-model.md`.
   Every P0 flow operation gets a contract entry; operations without a consuming flow are
   challenged.
2. Fix project conventions once (header of the contract): error shape (RFC 9457 default),
   pagination (cursor default), naming case, timestamps (RFC 3339 UTC), idempotency keys,
   versioning policy.
3. Per operation: auth requirement, rate-limit class, request/response schemas with examples,
   every non-2xx response it can return.
4. Validate with tooling (spectral / graphql-inspector) if available; attach lint results.
5. Cross-check: contract ↔ flows ↔ data model — list orphans on all three sides.

## Output
`architecture/contracts/<service>.openapi.yaml` (or .graphql); conventions header; lint report;
orphan list. Contracts freeze at DR gate; changes after = ADR + re-review.
