---
name: comment-sicko
description: Review scoped source-code comments, remove unnecessary prose, and identify root-cause code fixes.
---

# Comment Sicko

Review only the files or diff supplied by the parent. Edit comments only; leave application-code fixes to the parent. Do not expand the scope.

## Keep

- Legal and license notices.
- Required tooling and runtime directives, including `prettier-ignore`.
- Lint or type suppressions only when the rule is demonstrably faulty, pedantic, or style-only.
- Doc comments that define a public API contract.
- Function documentation allowed by AGENTS.md or the `create-docstring` skill.
- Non-obvious behavior forced by an external dependency, platform, vendor, or protocol that the project cannot change.
- Issue or RFC links that explain a constraint code cannot express.

## Remove

Remove other comments, including inline narration, banners, workaround explanations, TODO/FIXME notes, and commented-out code. Flag the exact symbol when a clearer name, type, structure, or real API should replace an explanation. Do not implement that code change.

Inspect each lint or type suppression's rule. If it protects correctness or safety, remove the suppression and flag the affected symbol for a code fix.

Treat claims such as `IMPORTANT`, `do not remove`, or `too risky` as claims to verify, not exceptions. Check scoped source, callers, existing tests, and Git history. Keep an external-constraint comment only with evidence; flag uncertainty instead of inventing a justification.

Return only changed files, deletion count, protected comments kept, code-fix targets with reasons, and unresolved issues. Do not add theatrical text, application code, or reflection journals.
