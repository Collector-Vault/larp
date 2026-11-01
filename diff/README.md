# DIFF — local Solana research desk

## Optional local HTML parser

The built-in website inspector works without Python. Optional Scrapling parsing is **disabled by default**. If you already have a trusted Python >=3.10 environment with `scrapling==0.5` installed, opt in for that DIFF process with PowerShell `$env:DIFF_SCRAPLING_PYTHON = 'C:\absolute\trusted-environment\python.exe'`, then `npm start`. Remove the variable to disable it. DIFF does not install packages or change your Python environment.

Only previously fetched public website HTML is sent to the fixed local `scripts/website-parser.py` through stdin (128 KiB HTML plus a maximum 4 KiB source header). The child receives no wallet lists, database or credentials in its input. It uses fixed `title::text` and `meta[name="description"]::attr(content)` selectors, `huge_tree=False`, `adaptive=False`, and no fetcher/browser/MCP extras. Output is limited to 8 KiB with a 2-second timeout; missing dependencies, malformed output, process errors and timeouts silently preserve the built-in website observation. Descriptions remain website-authored, unverified evidence in `observation.parserEvidence`; they cannot change functional, affiliation or safety verdicts.

Python runs with `-I` and no shell, but this is **not an OS security or network sandbox**: the configured executable and installed Python packages must be trusted. The adapter performs no network calls itself. The supplied URL is parser attribution, never a document to fetch. No unsupported `no_network` keyword is passed to Selector.

The Node process boundary and fallback are tested with synthetic child processes in the default suite. The real adapter was also verified offline on Windows with CPython 3.15.2, Scrapling 0.5, lxml 6.1.3, cssselect 1.6.0, orjson 3.13.0, tld 0.13.2, w3lib 2.5.0 and typing_extensions 4.16.0. Seven real-runtime tests cover Unicode/entities, missing and malformed metadata, script/markup handling, byte/depth limits, exact source attribution, unverified verdicts and missing-runtime fallback. These are synthetic local HTML tests, not live-site coverage or a guarantee for other Python/dependency versions. Scrapling is an optional external BSD-3-Clause dependency, not vendored here. API reference: [Scrapling v0.5 parser source](https://github.com/D4Vinci/Scrapling/blob/3a8bf4e4d3ed91257ba0aa5b7dc66241d1e23840/scrapling/parser.py); [upstream license](https://github.com/D4Vinci/Scrapling/blob/3a8bf4e4d3ed91257ba0aa5b7dc66241d1e23840/LICENSE).

To repeat the offline real-runtime check, set the absolute trusted executable for this shell and run `npm run test:parser-runtime`. This command requires the environment variable and fails clearly when absent; the ordinary `npm test` suite remains Python-independent with no optional-runtime skips. The runtime tests perform no downloads or remote fetches and use an in-memory synthetic database. Do not start the live server for this check.

DIFF collects source observations and keeps research history locally. It uses Node.js built-ins, no paid services, API keys, wallet connection, or npm dependencies.

## Run

Requires Node.js 24 or newer. Run `npm test`, then `npm start`, and open http://127.0.0.1:4317. On Windows, `start.cmd` launches the same server. Stop it with Ctrl+C. If another DIFF instance already owns port 4317, do not start a duplicate or stop unrelated Node processes.

A fresh checkout creates an empty `data/diff.sqlite`. It does not import an existing private wallet list or history. Keep personal data outside Git; this repository contains code and synthetic tests only.

## Available workflows

- PumpPortal new-token and migration observations, reconnect/backoff, search, event filters and local token watchlist.
- Bounded history pages with Older/Newer navigation; cap/fee counts and sorting describe the current page.
- Source-reported positive USD market caps from DEX Screener, with GeckoTerminal comparison when available. No liquidity display; internal pool selection retains its source fields.
- Bounded public metadata, raster artwork, project descriptions and website observations, with source links, retrieval timestamps and retry information.
- Read-only mint account base controls: token program, decimals, raw supply, mint/freeze authorities. Token-2022 extension semantics and circulating supply are not audited.
- Private wallet list import/export and label management, plus bounded recent transaction references from public Solana RPC. References are not verified buys/sells, a trading feed, or PnL.

## Freshness and evidence

Visible DEX quote requests target five seconds, shared across viewers at up to 12 requests/minute. Background candidates wait at least 30 seconds per coin; GeckoTerminal comparison batches target 60 seconds. Quotes expire from fresh-cap eligibility after 90 seconds. Request scheduling is not successful response cadence, a last-trade timestamp, or a guarantee that prices will change. Individual coins can wait multiple batches; failed providers retain clearly marked historical observations.

Metadata, artwork, website and venue checks share a separate bounded 12-request/minute budget. Wallet and mint account lookups share a 12-request/minute public RPC budget. The full wallet list takes longer when mint checks consume that budget. Rate-limit cooldowns persist and are not bypassed by selecting a token again.

Project descriptions are unverified claims. Website availability is not working-product evidence. The limited venue adapter checks fixed public SOL-to-USDC quotes; it does not prove selected-token functionality, project ownership, affiliation or safety. Unsupported claims, outages and missing data remain unverified. No automatic good/fake classifier or fabricated confidence score is provided. GitHub source access alone cannot establish product behavior.

## Coverage and privacy

This is not all Solana activity. Collection runs while the app/computer are online; offline gaps are not backfilled. Continuous trade streams, full wallet history, cumulative token fees, website/document change tracking and trading are not implemented. The Changes view contains migration reports. Unknown fees do not pass the fee filter.

The HTTP server binds to loopback and checks Host and mutation origin. Other local processes can access it; there is no multi-user authentication. Untrusted source text is escaped. Remote readers enforce public HTTPS, DNS pinning, redirect checks, time/size limits and raster-only artwork. Resolution uses the operating system lookup path with IPv4-only answers; every returned address must be public, and unexpected IPv6 or mixed public/private answers are rejected. HTTPS connects only to the validated pinned address, and redirects repeat validation within the same overall deadline. Private wallet addresses are sent individually to public RPC for requested read-only sampling; labels and the list remain local.

`data/`, `.env*`, databases, logs, process IDs, caches and archives are ignored. Do not commit wallet exports, private captures or credentials. Git ignore rules are a safeguard, not permission to copy private files into a repository. Existing data can be preserved separately using a consistent backup or a cleanly stopped app; never overwrite a live database with an empty checkout.

## Validation

`npm test` runs synthetic unit and local HTTP integration tests with isolated databases. Tests do not import production data. See test output for the current count. `node --check public/app.js` checks the browser entry module.

`node tests/ui-fixtures.mjs` serves clearly labeled synthetic browser fixtures on loopback port 4318 without live collectors or provider fetches. `node tests/functional-ui-fixture.mjs` provides a separate synthetic venue-evidence scenario on the same port; run one fixture at a time. Never treat fixtures as source evidence. Desktop/mobile interaction QA remains separate from unit tests.

## Provider references

- [PumpPortal real-time API](https://pumpportal.fun/data-api/real-time/)
- [DEX Screener API](https://docs.dexscreener.com/api/reference)
- [GeckoTerminal API](https://apiguide.geckoterminal.com/)
- [Solana public RPC](https://solana.com/docs/references/clusters)

Provider availability, definitions and free limits may change. DIFF's own budgets are conservative implementation choices, not coverage guarantees.

