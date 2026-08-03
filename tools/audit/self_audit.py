#!/usr/bin/env python3
"""Framework self-audit: consistency checks between CLAUDE.md, agents, skills,
workflow catalog, and constraints. Stdlib only. Exit 1 on any failure (CI-ready)."""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
errors: list[str] = []
warnings: list[str] = []

# The framework files under audit are private and gitignored in public project
# repos - a CI checkout there legitimately lacks them. Skip (exit 0) instead of
# crashing so the workflow stays green wherever the framework is not deployed.
_REQUIRED = [
    ROOT / "CLAUDE.md",
    ROOT / ".claude" / "agents",
    ROOT / ".claude" / "skills",
    ROOT / ".claude" / "docs" / "workflow-catalog.yaml",
    ROOT / ".claude" / "docs" / "studio-framework.md",
    ROOT / "constraints" / "platforms",
]
_missing = [p for p in _REQUIRED if not p.exists()]
if _missing:
    print("self-audit SKIPPED: framework files not present in this checkout "
          "(private, gitignored):")
    for p in _missing:
        print(f"  - {p.relative_to(ROOT)}")
    sys.exit(0)


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def frontmatter(text: str) -> dict:
    """Flat `key: value` frontmatter only — agent/skill frontmatter is intentionally flat
    (name/description/model). Nested structures would need a real YAML parser; the audit
    flags missing keys either way, so a richer format fails loudly here, not silently."""
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, re.DOTALL)
    if not m:
        return {}
    fm = {}
    for line in m.group(1).splitlines():
        if ":" in line and not line.startswith((" ", "\t")):
            k, v = line.split(":", 1)
            fm[k.strip()] = v.strip()
    return fm


def yaml_list(text: str, key: str) -> list[str]:
    """Collect `key:` list entries in both inline ([a, b]) and block (- a) YAML styles.
    Errors on any `key:` occurrence neither form recognizes, so a reformatted catalog
    cannot silently skip consistency checks."""
    items: list[str] = []
    parsed = 0
    for m in re.finditer(rf"^\s*{key}:\s*\[([^\]]*)\]", text, re.MULTILINE):
        parsed += 1
        items += [x.strip() for x in m.group(1).replace("\n", " ").split(",") if x.strip()]
    for m in re.finditer(rf"^(\s*){key}:\s*$\n((?:\1\s+-\s*\S.*\n?)+)", text, re.MULTILINE):
        parsed += 1
        for line in m.group(2).splitlines():
            item = line.split("-", 1)[1].split("#", 1)[0].strip().strip("'\"")
            if item:
                items.append(item)
    total = len(re.findall(rf"^\s*{key}:", text, re.MULTILINE))
    if parsed < total:
        errors.append(f"workflow-catalog: {total - parsed} '{key}:' block(s) in an unrecognized format (use inline [] or a '- item' block list)")
    return items


# --- collect agents ---
agents_dir = ROOT / ".claude" / "agents"
agent_files = sorted(agents_dir.glob("*.md"))
agents: set[str] = set()
for f in agent_files:
    fm = frontmatter(read(f))
    name = fm.get("name", "")
    if not name:
        errors.append(f"agent {f.name}: missing frontmatter name")
        continue
    if name != f.stem:
        errors.append(f"agent {f.name}: frontmatter name '{name}' != filename")
    if not fm.get("description"):
        errors.append(f"agent {f.name}: missing description")
    if fm.get("model") not in {"opus", "sonnet", "haiku"}:
        errors.append(f"agent {f.name}: model must be opus|sonnet|haiku, got '{fm.get('model')}'")
    agents.add(name)

# --- collect skills ---
skills_dir = ROOT / ".claude" / "skills"
skills: set[str] = set()
for d in sorted(skills_dir.iterdir()):
    if not d.is_dir():
        continue
    sk = d / "SKILL.md"
    if not sk.exists():
        errors.append(f"skill {d.name}: missing SKILL.md")
        continue
    fm = frontmatter(read(sk))
    if fm.get("name") != d.name:
        errors.append(f"skill {d.name}: frontmatter name '{fm.get('name')}' != dir name")
    if not fm.get("description"):
        errors.append(f"skill {d.name}: missing description")
    skills.add(d.name)

# --- framework doc registry vs agent files ---
# The registry lives in .claude/docs/studio-framework.md (loaded on demand), not in
# CLAUDE.md — CLAUDE.md stays lightweight and must keep pointing at it.
claude_md = read(ROOT / "CLAUDE.md")
framework_path = ROOT / ".claude" / "docs" / "studio-framework.md"
framework_md = read(framework_path)
framework_rel = "/".join(framework_path.relative_to(ROOT).parts)
if framework_rel not in claude_md:
    errors.append(f"CLAUDE.md: no reference to {framework_rel} (progressive disclosure broken)")
reg_m = re.search(r"## Agent Registry\n(.*?)\n## ", framework_md, re.DOTALL)
reg_text = reg_m.group(1) if reg_m else ""
if not reg_m:
    errors.append(f"{framework_rel}: '## Agent Registry' section not found")
registry = set(re.findall(r"^- \*\*([a-z0-9-]+)\*\*", reg_text, re.MULTILINE))
for a in sorted(registry - agents):
    errors.append(f"registry lists '{a}' but .claude/agents/{a}.md missing")
for a in sorted(agents - registry):
    errors.append(f"agent file '{a}' not listed in the {framework_rel} registry")

# --- skills referenced in CLAUDE.md / framework doc exist ---
for src_name, text in (("CLAUDE.md", claude_md), (framework_rel, framework_md)):
    for s in set(re.findall(r"`/([a-z0-9-]+)`", text)):
        if s not in skills:
            errors.append(f"{src_name} references skill /{s} that does not exist")

# --- workflow catalog references ---
catalog = read(ROOT / ".claude" / "docs" / "workflow-catalog.yaml")
for s in yaml_list(catalog, "skills"):
    if s not in skills:
        errors.append(f"workflow-catalog references unknown skill '{s}'")
for a in yaml_list(catalog, "agents"):
    if a in ("all leads",):
        continue
    if a not in agents:
        errors.append(f"workflow-catalog references unknown agent '{a}'")

# --- platform catalogs for every selectable deployment target ---
targets = ["aws", "gcp", "azure", "cloudflare", "vercel", "kubernetes", "vps"]
for t in targets:
    if not (ROOT / "constraints" / "platforms" / f"{t}.yaml").exists():
        errors.append(f"missing platform catalog constraints/platforms/{t}.yaml")

# --- skills referencing templates that must exist ---
tmpl_dir = ROOT / ".claude" / "docs" / "templates"
for d in sorted(skills_dir.iterdir()):
    sk = d / "SKILL.md"
    if not sk.exists():
        continue
    for t in set(re.findall(r"templates?[:/]\s*([a-z0-9-]+\.md)", read(sk))):
        if not (tmpl_dir / t).exists():
            errors.append(f"skill {d.name}: references missing template {t}")

# --- agents referenced by skills exist ---
for d in sorted(skills_dir.iterdir()):
    sk = d / "SKILL.md"
    if not sk.exists():
        continue
    for a in set(re.findall(r"\*\*([a-z0-9-]+(?:-[a-z0-9]+)*)\*\*", read(sk))):
        if re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)+", a) and a not in agents and a not in skills:
            warnings.append(f"skill {d.name}: bold token '{a}' matches no agent (check name)")

print(f"agents: {len(agents)}, skills: {len(skills)}")
for w in warnings:
    print(f"WARN  {w}")
for e in errors:
    print(f"ERROR {e}")
print(f"\n{len(errors)} error(s), {len(warnings)} warning(s)")
sys.exit(1 if errors else 0)
