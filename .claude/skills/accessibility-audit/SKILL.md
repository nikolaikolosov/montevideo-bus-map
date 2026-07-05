---
name: accessibility-audit
description: Audit the application against its WCAG target level - automated scan plus manual keyboard and reader passes, findings by success criterion.
---

# /accessibility-audit

Owner: **accessibility-specialist**; verdict feeds **qa-lead**'s QG.

## Sequence
1. Target level from `constraints/accessibility.yaml` (per quality_class). State it and the
   audit scope (which pages/flows) up front.
2. Automated pass: axe-core/Lighthouse a11y on P0 pages — catches roughly a third of issues;
   labeled as automated-only coverage.
3. Manual keyboard pass: every P0 flow completable keyboard-only — focus order, visible focus,
   no traps, skip links.
4. Reader pass: landmarks, headings hierarchy, form labels + error announcements, dynamic
   content announcements (live regions), image alts.
5. Findings by WCAG criterion number with severity, element evidence (selector), concrete fix;
   fixes routed to ui-engineer; re-test after fix.
6. Regression guard: axe checks in the e2e suite confirmed wired (with test-automation-engineer).

## Output
`qa/reports/a11y-report-vNN.md`: coverage statement, findings by criterion, fix status,
verdict vs target level for QG.
