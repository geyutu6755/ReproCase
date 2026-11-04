# Handover quarantine — uncommitted ZCode change

Captured: 2026-11-01, at the start of the v0.3.1 formal takeover.
Branch created from: `989d137` (= tag `v0.3.0` = `origin/main`).

## What was found

The working tree was NOT clean when the takeover began. One tracked file
carried uncommitted modifications that were not authored as part of this
v0.3.1 run:

- `src/report/issue.ts` — +63 / −10. Adds cluster-aware rendering to the
  combined GitHub-issue document: a new `renderFindingBody` split, a
  `renderClusterMarkdown` helper, and a rewrite of `renderIssuesMarkdown`
  so `js-exception` / `console-error` findings render grouped by fault
  cluster while every other finding type renders standalone. It references
  `ScanResult.clusters` and `FaultCluster` (both already exist at v0.3.0).

It builds (`tsc` passes) but ships **no test coverage** for the new cluster
path. It is left uncommitted here; it is NOT folded into the v0.3.1 baseline.

## How it was preserved

- `zcode-issue-ts.patch` — `git diff` of the change (re-apply below).
- `CHANGED-FILES.txt` — `git diff --stat`.
- `STATUS.txt` — `git status --porcelain` at capture time.

## How to re-apply (from a clean tree on fix/v0.3.1-reliability or main)

    git apply .qoder-handover/zcode-issue-ts.patch

## How it was removed from the working tree

After saving the patch above, the file was restored to the committed v0.3.0
baseline so v0.3.1 work starts from a verified clean state:

    git restore src/report/issue.ts

No ZCode work was overwritten or discarded — the full diff is above.
