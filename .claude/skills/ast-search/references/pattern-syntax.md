# AST Search Pattern Syntax

Pattern examples for `ast-grep` (and `semgrep` which uses the same metavariable conventions).

## Metavariables

| Syntax | Matches |
|---|---|
| `$VAR` | Any single AST node (expression, identifier, type, etc.) |
| `$$$` | Any sequence of nodes (zero or more) |
| `$_` | Any single node, unnamed (throwaway) |

---

## JavaScript / TypeScript (`--lang js` / `--lang ts`)

### Find all calls to a function by name

```
$VAR.parseUrl($$$)
```

### Find all async arrow functions

```
async ($$$) => { $$$ }
```

### Find all `try/catch` blocks

```
try { $$$ } catch ($VAR) { $$$ }
```

### Find all React hooks starting with `use`

```
const [$VAR, $VAR2] = useState($$$)
```

### Find all imports of a specific module

```
import { $$$ } from 'lodash'
```

### Find all usages of a class method

```
new $CLASS($$$).$METHOD($$$)
```

---

## Python (`--lang python`)

### Find all function definitions with a decorator

```
@$DECORATOR
def $FUNC($$$):
    $$$
```

### Find all `with` statements (context managers)

```
with $EXPR as $VAR:
    $$$
```

### Find all `raise` statements for a specific exception

```
raise ValueError($$$)
```

### Find all dictionary comprehensions

```
{$KEY: $VAL for $VAR in $ITER}
```

---

## Go (`--lang go`)

### Find all error returns

```
return $$$, err
```

### Find all goroutine launches

```
go $FUNC($$$)
```

### Find all channel sends

```
$CHAN <- $VAL
```

### Find all struct field accesses

```
$VAR.$FIELD
```

### Find all defer statements

```
defer $FUNC($$$)
```

---

## Translating find-reuse terms to patterns

| Search term | Language | Pattern |
|---|---|---|
| `parse url` | js/ts | `$_.parse($URL)` or `new URL($URL)` |
| `format date` | js/ts | `$_.format($DATE, $$$)` |
| `retry request` | go | `for $$${ $$$http.$METHOD($$$) }` |
| `validate email` | python | `re.match($$$, $EMAIL)` |
| `open file` | go | `os.Open($PATH)` |
| `read json` | python | `json.load($$$)` or `json.loads($$$)` |

When in doubt, start with a broad `$FUNC($$$)` pattern and narrow from there.
