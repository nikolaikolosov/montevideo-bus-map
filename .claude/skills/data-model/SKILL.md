---
name: data-model
description: Design the data model - entities, access patterns, storage mapping per the platform catalog, lifecycle and migration strategy. Phase 2 data core skill.
---

# /data-model

Owner: **data-lead**; physical design review by **db-engineer**; PII/compliance pass by
**compliance-analyst** when flags set.

## Sequence
1. Entities and relationships from the user flows and requirements: attributes, invariants,
   expected volumes and growth (numbers, with assumption labels).
2. **Access-pattern table first**: every read/write path with frequency class and consistency
   need. This table justifies all storage choices.
3. Storage mapping: pattern-by-pattern assignment to the store(s) chosen in the architecture
   variant, citing `constraints/platforms/<target>.yaml` entries (limits, consistency model,
   pricing dimension). Polyglot only where a pattern demands it — every extra store is
   operational burden.
4. PII tagging per field; retention/deletion path per compliance flags; caching layers with
   invalidation triggers; backup/restore requirements per SLO tier.
5. Migration strategy: tooling, reversibility policy, zero-downtime approach (expand-migrate-
   contract as default for post-launch changes).

## Output
`architecture/data-model.md` (entities, access patterns, mapping, lifecycle); open questions;
physical schema work handed to db-engineer at Build.
