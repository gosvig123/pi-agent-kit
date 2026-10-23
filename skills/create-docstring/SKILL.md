---
name: create-docstring
description: Use when writing or changing a function and callers need details its name and types do not show, such as input limits, side effects, or behavior on empty input. Also use when asked to write or update function documentation. Match the detail to the user's language familiarity.
---

# Create docstring

## When to use

Use this skill when writing or changing a function and a caller needs details its name and types do not show. Examples include whether the function modifies an argument, what it returns for empty input, or whether a tensor mask includes or excludes `True` values. Also use it when the user asks for function documentation.

Skip documentation that would only repeat names and types. If unclear variable names or unnecessary branches make the code hard to follow, report that code issue rather than explain it in a docstring.

## Language familiarity

Use the language preferences in AGENTS.md. Give more explanation in languages the user knows less well, including unfamiliar ownership or async behavior when it matters to the function. Otherwise, focus on input requirements and observable behavior. Do not explain individual lines of syntax.

## Format

Describe what the function does, its inputs, and its output. Do not repeat what names and types already make clear.

- Python: use a short behavior summary and Google-style `Args:` and `Returns:` sections when useful, following PEP 257 conventions. Omit unnecessary sections.
- JavaScript/TypeScript: follow the repository's JSDoc or TSDoc style.
- Rust: use `///` documentation comments.
- Go: use a documentation comment beginning with the function's name.
- C/C++: follow the repository's documentation style, such as Doxygen.
- Other languages: follow the repository's native function-documentation style.

For example, `masked_softmax` computes probabilities from selected tensor values. A caller needs to know whether `True` selects or excludes a value and what the function returns when every value is excluded.

```python
from torch import Tensor

def masked_softmax(logits: Tensor, mask: Tensor, dim: int = -1) -> Tensor:
    """
    Compute softmax over the included values.

    Args:
        logits: Finite floating-point tensor.
        mask: Boolean tensor matching logits; True includes a value.
        dim: Dimension along which to normalize.

    Returns:
        Tensor with the same shape as logits. Excluded values are zero.
        Slices with no included values return all zeros, not NaN.
    """
    masked_logits = logits.masked_fill(~mask, float("-inf"))
    empty = ~mask.any(dim=dim, keepdim=True)
    safe_logits = masked_logits.masked_fill(empty, 0)
    return safe_logits.softmax(dim=dim).masked_fill(~mask, 0)
```

## Scope

Read the function, its callers, and existing tests before documenting its behavior. If the behavior is unclear, report what you could not determine. Do not invent guarantees or claim checks you did not run.

Change only function documentation. Do not refactor code, add tests or dependencies, access credentials, or publish changes without separate authorization.
