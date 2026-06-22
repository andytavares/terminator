# Test Smell Rubric

Detailed checklist for the `test-quality-review` skill. Source: *Software Engineering at Google*,
Ch. 11–14 (Testing Overview, Unit Testing, Test Doubles, Larger Testing).

## Smell → why it's bad → fix

| Smell (grep-able signal) | Why it's bad | Fix |
|---|---|---|
| Asserting on private state / calling private methods | Breaks on refactors that preserve behavior | Test through the public API only |
| `verify(...)`, `.toHaveBeenCalledWith(...)`, call-order assertions | Couples test to implementation, not outcome | Assert on resulting state instead |
| Mocking a type you don't own | Mock drifts from real behavior; false confidence | Use a fake the owner provides, or the real thing |
| Many mocks in one test | Test re-specifies the implementation; brittle | Replace with a fake; assert state |
| `sleep(`, `Thread.sleep`, polling with timeouts | Slow and flaky; timing is non-deterministic | Use fakes/injected clocks; await explicit signals |
| Real network / real DB in a unit test | Non-hermetic, flaky, slow | In-memory fake or hermetic test double |
| `new Date()` / `time.Now()` / `Math.random()` unmocked | Non-deterministic | Inject clock / seed / value |
| Shared mutable static/global between tests | Order-dependent flakiness | Isolate per-test state; no shared mutation |
| Test depends on another test running first | Order-dependent; fails under sharding | Make each test self-contained |
| One test, many unrelated assertions | Failure doesn't localize the cause | One behavior per test |
| Test name = method name (`testGetUser`) | Says nothing about the scenario/expectation | Name the scenario + expected result |
| Heavy shared setup / helper indirection (over-DRY) | Reader can't see preconditions | Inline the relevant setup (DAMP) |
| Logic in tests (loops/conditionals computing expected) | Bugs in test logic hide bugs in code | Spell out expected values literally |

## The double hierarchy (prefer top to bottom)

1. **Real implementation** — when it's fast, deterministic, and has no problematic deps.
2. **Fake** — a working lightweight implementation (in-memory DB, fake clock) maintained by the owner.
3. **Stub** — hardcoded return values for specific calls. Use sparingly.
4. **Mock** — verifies interactions. Last resort; the main source of brittle tests.

## Test sizes (Google taxonomy — by resources, not scope)

- **Small** — single process, single thread, no I/O (no network, no real DB, no sleep). Fast,
  deterministic. The bulk of the suite should be here.
- **Medium** — single machine, may touch localhost services / local DB. Slower; use when a small
  test can't give real confidence.
- **Large** — multiple machines / real backends. Few of these; reserved for end-to-end confidence.

Size (resources consumed) is independent of scope (how much code is exercised). Aim for small size
with as much scope as a fake allows.

## Quick grep signals for a first pass

```
rg -n 'sleep\(|Thread\.sleep|time\.Now\(\)|new Date\(\)|Math\.random' <testfiles>
rg -n 'verify\(|toHaveBeenCalled|when\(.*\)\.thenReturn|mock\(' <testfiles>
```
A hit is a *prompt to look*, not an automatic failure — judge each in context.
