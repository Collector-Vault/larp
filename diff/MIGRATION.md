# Source-only migration

Prepared from the active local DIFF source on 2026-11-01, then updated and validated in an isolated source-only checkout. The original app and private data remain in place. The package includes application source, current documentation and synthetic tests; it excludes original Git history, runtime databases, wallet lists and exports, logs, process IDs, cache, credentials, screenshots, private captures, archives and ad-hoc repair scripts.

Run with Node >=24: npm test; npm start. Start creates a new empty local data directory; it does not import the original private data.

README documents the current workflows, privacy boundaries and validation commands. Both `tests/ui-fixtures.mjs` and `tests/functional-ui-fixture.mjs` are portable synthetic fixtures with shared support in `tests/helpers/fixture-support.mjs`. They use isolated databases, perform no live collector/provider requests and require no external evidence capture. Run one at a time on loopback port 4318; their clearly labeled display scenarios are not source observations. The automated suite also checks fixture portability and isolation.

The authorized public destination is [Collector-Vault/larp](https://github.com/Collector-Vault/larp), with source under `diff/` on the planned new branch `codex/diff-reliability-2026-11-01`. Publication is limited to this code-only subtree and preserves existing repository contents. Branch publication is subject to final source review and manifest verification; no pull request, merge or deployment is included.
