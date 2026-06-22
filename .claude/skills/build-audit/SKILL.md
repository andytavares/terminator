---
name: build-audit
description: Diagnostic skill for build, test, and tooling problems. "Why is X slow?", "Are we using Y correctly?", "What's the bottleneck in our Z?". Cross-references the actual configuration with the tool's official documentation and produces ranked hypotheses.
---

# Build audit

Use this when the question is diagnostic: something is slow, flaky, or doesn't match how the tool is "supposed" to be used.

## Procedure

1. **State the symptom precisely.** "Bazel python builds are slow" is not enough. How slow? Compared to what? On what target? On which workstation profile?

2. **Collect data.** Use the tool's native introspection — don't guess.
   - Bazel: `bazel analyze-profile`, `bazel query`, `bazel cquery --output=build`, `--profile=profile.json`.
   - npm/yarn/pnpm: `--timing`, `--profile`.
   - Webpack/vite: `--profile`, bundle analyzer output.
   - Make: `make --debug=v`, `--print-data-base`.
   - Docker: `--progress=plain`, BuildKit traces.
   - pytest: `--durations=20`, `-p no:cacheprovider` for fairness.
   - go: `-x` to see invocations, `go build -gcflags="-m"` for inlining, `pprof` for runtime profiles.

3. **Read the actual config files.** BUILD/BUILD.bazel, package.json scripts, Makefile, Dockerfile, pyproject.toml. Identify what's actually configured vs what's assumed.

4. **Cross-reference with the official documentation.** This is the rule from CLAUDE.md: vendor docs first. For each suspect configuration, find the official guidance:
   - Bazel: bazel.build/docs.
   - Python packaging: packaging.python.org, hatch/poetry/pdm official docs.
   - Webpack: webpack.js.org/configuration.
   - The tool's own `--help` and man pages.

   Quote the exact doc passage when claiming "you're doing X but the docs recommend Y".

5. **Rank hypotheses by likelihood + impact.** A hypothesis is a sentence: "Symptom X is caused by configuration Y because Z, evidenced by [data point]." Score each:
   - **Confidence** (1-5): how strong is the evidence?
   - **Impact** (1-5): if fixed, how much would symptom improve?

6. **Check against the build-system standards.** Many build pathologies trace to a few root causes
   (see the `task-based-vs-artifact-based-builds`, `hermetic-builds`, `build-dependency-correctness`,
   and `distributed-builds` concepts):
   - **Task-based vs artifact-based.** Imperative task-based builds (Make, raw Gradle scripts) lose
     caching/parallelism/correctness that declarative artifact-based builds (Bazel, Buck, Pants) get
     for free. If the symptom is "no caching" or "rebuilds everything," name this.
   - **Hermeticity.** Non-reproducible builds usually have undeclared inputs: reads of the network,
     wall clock, `$HOME`, ambient env vars, or system-installed tools. A build that isn't hermetic
     can't be safely cached or distributed. Look for these leaks.
   - **Dependency correctness.** Implicit/transitive dependencies that aren't declared cause both
     under-building (stale) and over-building (slow). Check that declared deps match real deps.
   - **Distribution.** If builds are slow and the system supports remote execution/caching, flat
     build time as the codebase grows is the expected payoff — note if it's left on the table.

7. **Recommend the smallest verifying experiment.** For the top 1-2 hypotheses, what's the cheapest test that would confirm or rule out? Often: change one flag, re-run, compare.

## Report shape

```
Symptom: <precise statement>

Data collected:
  - <data point with command + key output line>
  - ...

Hypotheses (ranked):
  1. <Hypothesis sentence>
     Confidence: 4/5  Impact: 4/5
     Evidence: <pointer to data>
     Official guidance: <doc URL + verbatim quote>
     Smallest experiment: <command + expected signal>

  2. ...

Configuration drift from official guidance:
  - <Where our config differs from the docs, with citations>

Not yet investigated:
  - <things to check next>
```

See `references/diagnostic-checklist.md`.
