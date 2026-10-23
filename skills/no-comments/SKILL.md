---
name: no-comments
description: Review and remove unnecessary source-code comments. Use when asked to clean up comments or enforce the no-comments policy; preserve allowed function docstrings.
disable-model-invocation: true
---

# No comments

Use `/skill:no-comments` with files or a diff. Without a scope, review the current diff against the base branch (default `main`), including working-tree changes. Stay inside that scope.

## Function docstrings are allowed

You may add and keep docstrings that describe what a function does, its arguments, and its return value. This applies to public and private functions. No external constraint or public API contract is required.

Write the function first, then validate that it works through real execution or existing tests. Only after validation passes, add a docstring to help humans read the verified behavior. Do not write docstrings as implementation plans or use them instead of validation. When behavior changes, validate the change before updating its docstring.

This exception does not allow inline narration, workaround explanations, TODO/FIXME notes, or commented-out code.

```python
def argmax(input: Tensor, dim: int) -> Tensor:
    """
    Compute the argmax as a 1-hot tensor.

    Args:
        input : input tensor
        dim : dimension to apply argmax


    Returns:
        :class:`Tensor` : tensor with 1 on highest cell in dim, 0 otherwise

    """
    out = max_reduce(input, dim)
    return out == input
```

## Workflow

1. Enable the subagent tools with `subagents_enable` if needed. Run `subagent` with agent `comment-sicko` and `agentScope: "user"`. Pass the repository path, scoped files or diff, and permission to edit comments only. Inherit the host's model and reasoning defaults. If the agent is missing, reload Pi and check that pi-agent-kit and pi-subagents are installed; report a blocker if it is still unavailable.
2. Check the reviewer's diff and findings. Reject edits outside scope, application-code changes, and deletion of allowed comments or docstrings. Restore protected comments. Rerun once with the specific failure; stop and report if the second review still breaks these rules.
3. Fix accepted code issues with the smallest in-scope root-cause change. Use names, types, structure, or existing APIs instead of explanations. Sketch any needed structural change before implementing it. Report out-of-scope causes without widening the task.
4. For a proven external constraint, keep its allowed comment. Offer a type, runtime check, test, or lint rule that could replace it. Get approval before adding that enforcement, then delete the comment only if the enforcement fully replaces it.
5. Report changed files, deleted comments, code fixes, and unresolved issues. Do not create reflection journals. The review does not authorize publication, credential access, or destructive operations outside scoped comment cleanup.
