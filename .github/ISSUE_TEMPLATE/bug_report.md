---
name: Bug report
about: A scan result looks wrong (false positive, false negative, crash)
title: ''
labels: bug
assignees: ''
---

**What happened?**

A clear description. If a finding is wrong, say whether it is a
**false positive** (reported fault is not real), a **false negative** (a real fault was
missed), or a **wrong attribute** (right fault, wrong page/step/evidence).

**Reproduction**

```bash
# the exact command you ran (redact secrets — or better, use obviously fake ones)
reprocase scan --url http://127.0.0.1:3000/ ...
```

**Evidence**

- Attach `result.json` and, if relevant, the generated spec. Screenshots/traces can contain
  unredacted page data — review and crop before pasting.
- For false negatives: which page/button/URL was involved, and what did you expect?

**Environment**

- ReproCase version (`npx reprocase --version`):
- Node version:
- OS:
- Site type (static / SPA framework / server-rendered):

**Output of `npx reprocase doctor`** (if environment-related)
