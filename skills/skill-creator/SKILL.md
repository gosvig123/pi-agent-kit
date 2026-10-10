---
name: skill-creator
description: Creates, reviews, and improves Agent Skills for Pi or compatible harnesses. Use when asked to make a skill, package a repeatable workflow, or repair skill discovery and triggering.
---

# Skill Creator

Create the smallest skill that reliably triggers and guides work.

1. Read installed Pi `docs/skills.md` completely and inspect relevant existing skills.
2. Resolve choices affecting scope, tools, safety, or success. Use global `~/.pi/agent/skills/<name>/` or project `.pi/skills/<name>/` as agreed.
3. Write `SKILL.md`. Reuse existing guidance; add references or scripts only when they reduce complexity or provide needed deterministic work.
4. Validate frontmatter, triggers, relative paths, examples, safety boundaries, and size limits. Report vague triggers, untestable workflows, contradictory examples, unexplained non-portable paths, or actions beyond user authority.
5. Reload with `/reload`, confirm discovery, and check a positive and negative trigger when the runtime permits. Otherwise report these checks as pending, not passed.

## Contract

- `name`: 1–64 lowercase letters, digits, or hyphens; no leading, trailing, or consecutive hyphens.
- `description`: capability and concrete triggers, at most 1024 characters.
- Keep files within 200 lines and functions within 25. Resolve relative paths from the skill directory.
- State destructive, credential, network, and publication boundaries. Include expected-failure recovery; never embed secrets.

Report changed paths, trigger examples, validation, and pending setup.
