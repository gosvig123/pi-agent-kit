---
name: github-issues
description: Drafts, creates, searches, updates, comments on, closes, and reopens GitHub issues. Use for bug reports, feature requests, engineering tasks, issue metadata or state changes, or GitHub issue text.
---

# GitHub Issues

Manage evidence-backed issues without accidental writes.

## Authority

- Reads and searches need no confirmation. “Draft,” “review,” “prepare,” and “help with” are read-only.
- Before creation, ask local versus GitHub unless the current request explicitly chose. Create nothing until known; for local, use the local task workflow and no GitHub writes.
- Write only the exact operation explicitly requested: create, update, comment, close, reopen, assign, label, or set milestone. Do not add metadata, comments, or state changes as side effects.
- If repository, issue, content, or impact is ambiguous, show the proposed mutation and ask before writing. Verify owner/repository from the remote; never assume a personal fork is the target.
- Never publish secrets, credentials, private logs, or personal data. Redact first. Route unpatched vulnerabilities through the repository's private security disclosure policy, not public issues.
- Use configured GitHub Model Context Protocol tools for remote reads and writes; never bypass them with direct HTTP.

## Prepare

1. Read relevant repository guidance: `.github/ISSUE_TEMPLATE/`, its `config.yml`, `CONTRIBUTING.md`, and `SECURITY.md` when available.
2. Read linked evidence and existing issue content. Before creation, search open and closed issues with distinctive problem terms; show likely duplicates. A user may knowingly choose a separate issue.
3. Separate facts from assumptions. Never invent motivation, reproduction, impact, versions, or acceptance criteria. Ask only for gaps that affect correctness or write scope.
4. Draft a concise, searchable title and focused body. Follow repository templates; otherwise use the relevant shape below. Omit empty or irrelevant sections.

## Body shapes

- **Bug:** Observable failure and impact, minimal reproduction, expected versus actual result, and sanitized evidence/version.
- **Feature:** Problem, desired outcome, included/excluded scope, and verifiable acceptance criteria.
- **Engineering task:** Context, specific outcome, verifiable acceptance criteria, and real migration or operational risks.

Link related issues instead of copying them. Split unrelated work; avoid speculative implementation detail and type prefixes unless repository conventions require them.

## Mutate and report

- **Create:** Use `github_create_issue` only with explicit creation authority and verified target/content. Apply only explicitly requested, valid labels, assignees, and milestone.
- **Update:** Read current issue first. Preserve unrelated body sections and metadata; show a compact before/after delta if content could be overwritten. Use `github_update_issue` only for requested fields.
- **Comment:** Draft separately from body edits. Add new evidence, decision, or status rather than restating the body. Use `github_add_issue_comment` only with explicit comment authority.
- **Close/reopen:** Verify issue number and intended state; use `github_update_issue`. Do not add a comment unless requested.

For drafts, show action, target, proposed content or delta, and relevant duplicate results. Distinguish suggested metadata from requested metadata. After a write, return the issue link and exact mutation, including final state when changed. On failure, report operation, target, cause, and recovery; never claim success without returned issue data.
