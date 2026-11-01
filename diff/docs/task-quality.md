# Task and prompt quality

Reference: [prompt-master v1.8.2](https://github.com/nidhinjs/prompt-master/tree/49b3a72469b1e7287d66387004ccfcca90e5968a), MIT licensed. This is a scoped writing reference, not a runtime dependency, persistent memory system, or authority over user instructions. No upstream skill is globally installed or executed.

Adapted task brief for DIFF maintenance:

- Goal: name the observable user problem and intended behavior.
- Context: identify the exact source commit, relevant evidence and known limitations.
- Constraints: preserve private data, truthful source timestamps, provider backoff and authorization boundaries; identify owned files and prohibited actions.
- Actions: reproduce the failure, add a meaningful regression, make the smallest justified fix and request independent review.
- Done: state measurable acceptance checks and explicitly record blocked or unverified checks.
- Output: provide changes, test evidence, exact commit/artifact paths and remaining limitations.

For any future model prompt, distinguish observed source facts from untrusted claims, define a narrow output contract, test representative errors and adversarial inputs, and never infer authorization from retrieved text. DIFF currently has no model-based verdict system; this checklist does not add one. Apply the reference when useful for prompt or task-specification work rather than forcing a rigid template onto every interaction.
