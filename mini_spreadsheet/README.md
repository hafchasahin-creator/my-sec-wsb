# Mini spreadsheet engine

A small Excel: cells `A1`..`Z100`, arithmetic formulas with cell references,
automatic propagation, cycle detection, ranges and caching. Pure Python 3.8+,
standard library only, no `eval` and no parser library — the tokenizer and the
recursive-descent parser are in `spreadsheet/lexer.py` and
`spreadsheet/parser.py`.

## Run it

```console
$ python3 -m spreadsheet                    # interactive
$ python3 -m spreadsheet examples/demo.sheet  # or a script file
sheet> SET A1 10
sheet> SET A2 20
sheet> SET A3 =A1+A2
sheet> GET A3
> 30
sheet> SET A1 50
sheet> GET A3
> 70
```

Commands: `SET`, `GET`, `DEL`, `FORMULA`, `DEPS`, `LIST`, `HELP`, `EXIT`.
As a library:

```python
from spreadsheet import Spreadsheet
sheet = Spreadsheet()
sheet.set_cell("A1", "=SUM(B1:B10)")
sheet.get_value("A1")
```

## Tests

```console
$ python3 -m unittest discover     # 84 tests
```

## How it works

    text ──lexer──> tokens ──parser──> expression tree ──engine──> value
                                            │
                                            └─ references() ─> dependency graph

Each cell owns a compiled, immutable expression tree and the set of cells that
tree reads (its *precedents*); the sheet also keeps the reverse edges
(*dependents*), because propagation walks that way.

**Writing** a cell does no arithmetic. It compiles the text, asks the tree
which cells it reads, refuses the write if those edges would close a cycle,
re-points the edges and marks the downstream sub-graph dirty. The write is
atomic: a bad formula or a cycle leaves the sheet exactly as it was.

**Reading** a cell computes only the dirty cells it actually depends on, in
dependency order, and caches each result. Editing one cell in a 2,600-cell
sheet recomputes the 24 cells that read it, not the sheet.

Neither walk recurses over the cell graph — the cycle check, the invalidation
and the evaluation order all use explicit stacks — so a 1,500-cell chain is no
more dangerous than a two-cell one (there is a test for exactly that).

| operation | cost |
| --- | --- |
| `SET` | O(size of the sub-graph that goes stale) |
| `GET` | O(stale cells it depends on), 0 when nothing changed |
| cycle check | O(cells + edges reachable from the write) |

## Decisions worth flagging

* **Cycles are refused at write time**, with the whole chain in the message
  (`circular reference: C1 -> A1 -> B1 -> C1`), rather than being stored and
  discovered during evaluation. A stored cycle would make every later read
  pay for the detection.
* **Errors are values, not exceptions.** `1/0` makes a cell hold `#DIV/0!`,
  which propagates to everything downstream and clears when the divisor is
  fixed — the way a spreadsheet behaves. A *command* being invalid (bad
  formula, cycle, unknown cell) is a different thing and raises.
* **Blank cells read as `0` in arithmetic but are skipped inside ranges**, as
  in Excel: `=A1+1` on a blank `A1` is 1, while `AVG(C1:C20)` over three
  filled cells divides by three. A range still depends on every address it
  covers, so filling one later propagates.
* **A literal is its own value**, so `SET A1 10` costs no evaluation at all
  and only its dependents go stale.
* Unknown functions and out-of-grid references are rejected when the formula
  is written, not when it is read.

## Layout

| file | |
| --- | --- |
| `errors.py` | failed *commands* vs. error *values* (`#DIV/0!`) |
| `reference.py` | `A1`-style addresses and rectangular ranges |
| `lexer.py` | hand-written tokenizer |
| `parser.py` | recursive descent → expression tree |
| `ast_nodes.py` | the nodes: `evaluate(context)` and `references()` |
| `functions.py` | `SUM`, `AVG`, `MIN`, `MAX`, `COUNT` |
| `engine.py` | dependency graph, cycle detection, caching, evaluation |
| `repl.py` | the `SET`/`GET` command layer (all rules live in the engine) |
