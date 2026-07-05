---
name: security-review
description: Full security review at the quality gate - scans, threat-model verification, finding triage with severities.
---

# /security-review

Owner: **security-lead**; scans executed by **security-tester**.

## Sequence
1. Scope first: active scans (DAST) target this project's local/staging environments (or
   other systems the user is authorized to test). State the scope in the report header.
2. Scan battery (configs committed to `security/scans/`): SAST (Semgrep), dependency audit
   (npm audit/pip-audit/Trivy), secret scan (gitleaks, full history), DAST baseline (ZAP)
   against a running local/staging instance.
3. Threat-model verification: every mitigation marked "build" or "verify" in
   `security/threat-model.md` is checked as actually implemented — file:line or config
   evidence per row.
4. Baseline conformance: headers, session/authn policy, input validation, rate limiting per
   `constraints/security-baseline.yaml` at the active level.
5. Triage: findings deduped, rated (critical/high/medium/low) with OWASP/CWE refs, evidence,
   concrete fix. False positives documented. Critical/high open holds QG until fixed or
   user-accepted.

## Output
`security/security-review.md`: scope note, findings table, mitigation verification table,
gate verdict.
