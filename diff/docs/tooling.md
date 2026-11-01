# Optional local tooling

The DIFF Node core remains dependency-free at runtime; the optional Scrapling adapter has separate dependencies. No MCP server, remote scan, registry ruleset, account, API key or CI integration is enabled by these files.

## Authored provider contracts

`market.mjs` validates the cap, FDV and price fields it consumes before replacing a saved quote. Null or absent figures remain unknown. Wrong types and nondecimal prices take the existing unavailable/backoff path, preserving the last successful value and fetched timestamp. These are reviewed local contracts inspired by schema-first tooling; they are not generated quicktype output and do not prove market truth. `tests/market-contract.test.mjs` uses synthetic data only.

[quicktype](https://github.com/glideapps/quicktype#generating-code-from-json-schema) supports generating types/converters from a reviewed schema. It was researched, not installed or executed. Sample inference alone is insufficient: samples cannot prove optionality, nullability or provider promises. A future local generation experiment must use synthetic inputs and review the generated code before use; never upload wallets, credentials or history to an online generator.

## Optional Semgrep rules

`tooling/semgrep.yml` contains authored rules for dynamic JavaScript execution and disabled TLS verification. `tooling/semgrep.js` is an inert rule-test fixture with positive and negative annotations. It must not be imported or executed as JavaScript.

Semgrep is not available in this environment. These rules have **not been run or validated by Semgrep**; fixture annotations are expected outcomes, not passing results. They are a review aid, not a security certification or complete detection of aliases, computed calls, wrappers, taint flows, SSRF or command injection. No regex-based substitute is advertised as an AST scan. The upstream `--validate` mode can pull registry rule-lints, so it is not part of this local-only workflow.

With an independently installed official Semgrep CLI, from the DIFF source directory:

```sh
semgrep scan --oss-only --metrics=off --disable-version-check --test tooling
semgrep scan --oss-only --metrics=off --disable-version-check --error --config tooling/semgrep.yml --exclude tooling --exclude tests .
```

These commands use local rules, do not require login, and exclude intentional test examples from the application scan. Do not use cloud `ci`, `login`, `publish`, remote configs or automatic registry selection for this workflow. Review the current CLI's privacy options and output before adding automation.

Official references: [Semgrep source](https://github.com/semgrep/semgrep), [CLI reference](https://docs.semgrep.dev/cli-reference), and [rule test documentation](https://semgrep.dev/docs/writing-rules/testing-rules).

## Discovery sources

The user-requested [awesome-mcp-servers directory](https://github.com/punkpeye/awesome-mcp-servers) and [free-for-dev directory](https://github.com/ripienaar/free-for-dev) were discovery resources, not installed dependencies or trust authorities. The selected concepts here were checked against upstream Semgrep and quicktype documentation. No listed server or hosted service was enabled, and directory inclusion is not an endorsement or security guarantee.
