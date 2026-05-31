# Test naming conventions (per language)

Match what already exists in the package. If the package has none yet:

- **JS/TS (jest/vitest):** `describe("<unit>", () => { it("<does behavior>", ...) })`
- **Python (pytest):** `def test_<unit>_<does_behavior>():`
- **Go:** `func Test<Unit>_<DoesBehavior>(t *testing.T)`
- **Rust:** `#[test] fn <unit>_<does_behavior>()`
- **Java (JUnit 5):** `@Test void <unit>_<does behavior>()`

Names describe behavior, not implementation. "returns 404 when user not found" not "calls getUser then throws".
