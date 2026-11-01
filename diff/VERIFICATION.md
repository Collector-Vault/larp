# Validation — 2026-11-01

This source snapshot received parallel implementation and independent task/whole-change review. Final full suite: **215 passed, 0 failed, 0 skipped** with Node 26.12.1. A fresh local Git clone passed the same suite without installing dependencies or supplying a data directory. All 61 JavaScript modules passed syntax checks.

New regressions cover worker reservation/cache failures and recovery; shared 403/429 cooldown write failures; visibility scheduling; selected-priority expiry; reachable 200-record history pages; stale search responses, failed navigation and polling during navigation; mint timestamp freshness; applicable supporting evidence; stage-specific retries; wallet drafts; fresh-cap sorting; and portable synthetic fixtures.

Desktop 1280px and mobile 390px browser QA used isolated synthetic fixtures with no collectors or provider requests. Verified older-page access from an empty fresh-cap page, search/filter/sort, pause/resume, detail disclosures/reopening, source disagreement and safe broken-image/text fallbacks, watch save, wallet draft/check/save/cancel, import/deduplication, removal and API export. Temporary fixture restart preserved watch and edited labels. Disconnect state appeared when that fixture stopped and recovered after restart. No horizontal overflow observed. The venue fixture showed one applicable supporting check while product behavior and token affiliation remained unverified.

No real wallet list, history, database, capture or credentials were used in these tests or included in the source publication. The existing local application was not replaced by this migration. Browser evidence is synthetic QA, not proof of upstream price accuracy or actual product functionality.

Limits: provider requests and successful quote retrievals are different events; a five-second scheduling target cannot guarantee five-second price changes. Pagination reflects current history rather than a frozen snapshot. A cooldown that storage cannot persist is protected in memory while the process runs, but cannot survive process termination until saved. Unsupported product checks and paid/all-trade coverage remain unavailable.
