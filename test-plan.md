# Test Plan — PR #3 (Remove RSS + dynamic Scholar stats)

Branch: `devin/1776518102-remove-rss` (latest: `615731c` "Fix BibTeX copy")
Local server: `python3 -m http.server 8765` in repo root

## Bug found and fixed during testing

**BibTeX copy buttons were copying an empty string.**
- Cause: source BibTeX lives inside `<template id="bib-*">` elements. On a `<template>`, `.textContent` returns `""`; the actual content is a DocumentFragment at `.content`.
- Evidence before fix: hooked `navigator.clipboard.writeText`, clicked "BibTeX" for ASM paper, observed `writeText` called with empty string.
- Fix (`assets/js/main.js:156-160`): use `(src.content || src).textContent` and early-return if resulting text is empty so the button never silently reports "Copied" on empty clipboard.
- Commit: `615731c` on `devin/1776518102-remove-rss`.

## Tests already executed and passed (first pass)
| Test | Result | Evidence |
|---|---|---|
| All 26 local `href`/`src` refs resolve to existing files | PASS | `python3` check, 0 missing |
| Theme toggle sets `data-theme="dark"`, `aria-pressed="true"`, persists via `localStorage["yanxp-theme"]="dark"` | PASS | console check + visual (dark bg) |
| Language toggle flips nav to 首页/论文/项目 and bio to Chinese | PASS | visual + DOM inspection |
| Conference filter shows exactly 6 conference entries (SC-OOD, ACM-MM, SCC, Meta R-CNN, MMI-ALI, SSM) | PASS | DOM count |
| Scholar badge stays `hidden` when `scholar.json` has `citations: 0` | PASS | `[data-scholar-badge][hidden]` in DOM |
| No `feed.xml` / `rss` substring anywhere in rendered HTML | PASS | regex scan of `document.documentElement.innerHTML` |

## Re-test after BibTeX fix (primary)

**Step 1**: reload `http://localhost:8765/Publication.html` → hook `navigator.clipboard.writeText` to record the argument.

**Step 2**: click the "BibTeX" button on the ASM (first journal) row.

**Pass criteria (all must hold):**
1. Hooked `writeText` was called with a non-empty string.
2. Captured string starts with `@article{wang2018costeffective,` (exact prefix from `<template id="bib-asm">`).
3. Captured string contains `title={Cost-Effective Object Detection` (verifies the full content, not just the opener).
4. Button text transitions to `Copied` for ~1.6s, then returns to `BibTeX`.

A broken implementation would fail at least one of these. The bug I just fixed would have failed (1) and (2).

## Flagged (not blocking this PR — pre-existing external-site breakage)
Three external links return real 404 from normal networks; these are not introduced by this PR but are worth flagging:
- `http://sdcs.sysu.edu.cn/content/2504` (index.html — Hui Cheng faculty page)
- `http://www.sysu-hcp.net/asm/` (Publication.html — ASM project page)
- `http://www.sysu-hcp.net/ssm/` (Publication.html — SSM project page)

## Regression — CI status on new commit
Re-run `git(pr_checks, wait_mode="all")` after the fix push. Must remain 2 passed, 0 failed.
