"""The sheet itself: dependency graph, cycle detection, caching, evaluation.

Design in one paragraph
-----------------------
Every cell owns a compiled expression and the set of cells that expression
reads (its *precedents*).  The sheet keeps the reverse edges too (*dependents*),
because propagation walks that direction.  Writing a cell does no arithmetic at
all: it re-points the edges, refuses the write if that would close a cycle, and
marks the affected sub-graph dirty.  Reading a cell computes only the dirty
cells it actually depends on, in dependency order, and caches each result.  So a
write is O(cells affected), a read is O(stale cells it depends on), and a cell
that nothing changed is never recomputed.

Nothing here recurses over the cell graph -- both the cycle check and the
evaluation order use explicit stacks -- so a 2,600-cell chain is no more
dangerous than a two-cell one.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, FrozenSet, Iterator, List, Optional, Sequence, Set, Tuple, Union

from .ast_nodes import EvalContext, Expr, Literal
from .errors import (
    CYCLE,
    NUM,
    CircularReferenceError,
    ErrorValue,
    EvaluationError,
    ParseError,
)
from .parser import parse_formula
from .reference import CellRef

Value = Union[float, ErrorValue]


@dataclass
class Cell:
    """A stored cell.  ``value`` is meaningful only while ``dirty`` is False."""

    raw: str
    node: Expr
    precedents: FrozenSet[CellRef]
    value: Optional[Value] = None
    dirty: bool = True

    def __post_init__(self) -> None:
        if isinstance(self.node, Literal):
            # A plain number is its own value: nothing to defer, and writing
            # one costs no evaluation at all.
            self.value = self.node.value
            self.dirty = False


class Spreadsheet:
    """A grid of cells addressed A1..Z100."""

    def __init__(self) -> None:
        self._cells: Dict[CellRef, Cell] = {}
        # ref -> cells whose formula reads ref.  Keyed by address, not by cell,
        # so a formula can depend on a blank cell that is filled in later.
        self._dependents: Dict[CellRef, Set[CellRef]] = {}
        self._context = _Context(self._cells)
        # Instrumentation: how many times a cell body has actually been
        # evaluated.  The caching tests assert on this.
        self.recompute_count = 0

    # -- public API -------------------------------------------------------
    def set_cell(self, name: str, raw: str) -> None:
        """``SET A1 10`` / ``SET A3 =A1+A2``.

        Either the write succeeds completely or the sheet is left exactly as it
        was: parsing and cycle detection both happen before anything mutates.
        """
        ref = CellRef.parse(name)
        node = self._compile(raw)
        precedents = frozenset(node.references())

        cycle = self._find_cycle(ref, precedents)
        if cycle is not None:
            raise CircularReferenceError(cycle)

        self._replace(ref, Cell(raw=raw.strip(), node=node, precedents=precedents))

    def get_value(self, name: str) -> Value:
        """``GET A3``.  A blank cell reads as 0, as it does in Excel."""
        ref = CellRef.parse(name)
        cell = self._cells.get(ref)
        if cell is None:
            return 0.0
        self._ensure_current(ref)
        assert cell.value is not None  # _ensure_current leaves it computed
        return cell.value

    def clear_cell(self, name: str) -> None:
        """``DEL A1``: the cell goes blank and its dependents recompute."""
        self._replace(CellRef.parse(name), None)

    def formula_of(self, name: str) -> str:
        """The text originally written into a cell (``""`` if blank)."""
        cell = self._cells.get(CellRef.parse(name))
        return cell.raw if cell is not None else ""

    def dependents_of(self, name: str) -> List[str]:
        """Cells whose formula reads this one directly."""
        ref = CellRef.parse(name)
        return sorted(dep.name for dep in self._dependents.get(ref, ()))

    def filled_cells(self) -> Iterator[Tuple[str, str, Value]]:
        """(name, raw, value) for every non-blank cell, in address order."""
        for ref in sorted(self._cells):
            yield ref.name, self._cells[ref].raw, self.get_value(ref.name)

    # -- writing ----------------------------------------------------------
    @staticmethod
    def _compile(raw: str) -> Expr:
        text = raw.strip()
        if text.startswith("="):
            return parse_formula(text)
        try:
            value = float(text)
        except ValueError:
            raise ParseError(
                f"{text!r} is not a number; a formula must start with '='"
            ) from None
        if not math.isfinite(value):
            raise ParseError(f"{text!r} is not a finite number")
        return Literal(value)

    def _replace(self, ref: CellRef, cell: Optional[Cell]) -> None:
        """Install (or delete) a cell and invalidate whatever depended on it."""
        previous = self._cells.pop(ref, None)
        if previous is not None:
            for precedent in previous.precedents:
                followers = self._dependents.get(precedent)
                if followers is not None:
                    followers.discard(ref)
                    if not followers:
                        del self._dependents[precedent]
        if cell is not None:
            self._cells[ref] = cell
            for precedent in cell.precedents:
                self._dependents.setdefault(precedent, set()).add(ref)
        self._invalidate_dependents(ref)

    def _invalidate_dependents(self, ref: CellRef) -> None:
        """Mark everything transitively downstream of ``ref`` as stale.

        The cell at ``ref`` itself is not touched: a freshly built ``Cell`` is
        already dirty (or, for a literal, already holds its value).

        The walk stops at cells that are already dirty: the invariant "a dirty
        cell's dependents are dirty too" means their sub-graphs were already
        marked, so a burst of writes into one region stays cheap.
        """
        stack = list(self._dependents.get(ref, ()))
        while stack:
            current = stack.pop()
            cell = self._cells[current]  # a dependent always has a formula
            if cell.dirty:
                continue
            cell.dirty = True
            cell.value = None
            stack.extend(self._dependents.get(current, ()))

    # -- cycle detection --------------------------------------------------
    def _find_cycle(
        self, target: CellRef, precedents: FrozenSet[CellRef]
    ) -> Optional[List[CellRef]]:
        """Would giving ``target`` these precedents close a loop?

        Depth-first search over the graph *as it would be after the write*,
        keeping the current path so the error can name the whole chain
        (``A1 -> B1 -> C1 -> A1``) instead of just saying "cycle".
        """

        def precedents_of(ref: CellRef) -> Sequence[CellRef]:
            if ref == target:
                return sorted(precedents)  # sorted: deterministic messages
            cell = self._cells.get(ref)
            return sorted(cell.precedents) if cell is not None else ()

        path: List[CellRef] = [target]
        on_path: Set[CellRef] = {target}
        explored: Set[CellRef] = set()
        stack = [(target, iter(precedents_of(target)))]

        while stack:
            node, children = stack[-1]
            child = next(children, None)
            if child is None:
                stack.pop()
                on_path.discard(node)
                path.pop()
                continue
            if child in on_path:
                return path + [child]
            if child in explored:
                continue
            explored.add(child)
            on_path.add(child)
            path.append(child)
            stack.append((child, iter(precedents_of(child))))
        return None

    # -- reading ----------------------------------------------------------
    def _ensure_current(self, ref: CellRef) -> None:
        cell = self._cells.get(ref)
        if cell is None or not cell.dirty:
            return  # cached: nothing it depends on has changed
        for stale in self._evaluation_order(ref):
            self._compute(stale)

    def _evaluation_order(self, ref: CellRef) -> List[CellRef]:
        """The dirty cells ``ref`` depends on, precedents first.

        An iterative post-order DFS over precedents: a cell goes onto the stack
        twice, once to expand it and once (the ``True`` marker) to emit it
        after everything it reads.  A cell is marked visited when it is
        *expanded*, not when it is queued -- with two cells reading the same
        precedent, marking on queue would let a cell be emitted before that
        shared precedent was.

        Clean cells are never entered: their cached values are used as they
        are, and that pruning is what keeps an edit to one column from touching
        the rest of the sheet.  The graph is acyclic (writes that would close a
        cycle are rejected), so post-order is a topological order; were a back
        edge ever to exist, it is skipped like any visited cell, leaving the
        precedent dirty for ``_Context`` to report as ``#CYCLE!`` -- the walk
        cannot spin.
        """
        order: List[CellRef] = []
        visited: Set[CellRef] = set()
        stack: List[Tuple[CellRef, bool]] = [(ref, False)]
        while stack:
            node, is_marker = stack.pop()
            if is_marker:
                order.append(node)
                continue
            if node in visited:
                continue
            visited.add(node)
            stack.append((node, True))
            for precedent in self._cells[node].precedents:
                cell = self._cells.get(precedent)
                if cell is not None and cell.dirty:
                    stack.append((precedent, False))
        return order

    def _compute(self, ref: CellRef) -> None:
        cell = self._cells[ref]
        self.recompute_count += 1
        try:
            number = cell.node.evaluate(self._context)
            value: Value = (
                number
                if math.isfinite(number)
                else ErrorValue(NUM, "result is not a finite number")
            )
        except EvaluationError as exc:
            value = exc.value  # #DIV/0! and friends are values, not failures
        cell.value = value
        cell.dirty = False


class _Context(EvalContext):
    """Read-only view of the cell map handed to expressions while they run.

    It only ever reads cached values: ``_evaluation_order`` guarantees every
    precedent was computed first.  Finding a dirty precedent would mean that
    guarantee was broken, so it reports ``#CYCLE!`` rather than recursing --
    a backstop that should be unreachable, never an infinite loop.
    """

    def __init__(self, cells: Dict[CellRef, Cell]) -> None:
        self._cells = cells

    def value_of(self, ref: CellRef) -> float:
        cell = self._cells.get(ref)
        if cell is None:
            return 0.0
        return self._unwrap(ref, cell)

    def values_in(self, refs: Sequence[CellRef]) -> List[float]:
        values: List[float] = []
        for ref in refs:
            cell = self._cells.get(ref)
            if cell is not None:  # blanks are skipped, not counted as zeros
                values.append(self._unwrap(ref, cell))
        return values

    @staticmethod
    def _unwrap(ref: CellRef, cell: Cell) -> float:
        if cell.dirty or cell.value is None:
            raise EvaluationError(
                ErrorValue(CYCLE, f"{ref} was not evaluated before its dependent")
            )
        if isinstance(cell.value, ErrorValue):
            raise EvaluationError(cell.value)  # errors flow downstream
        return cell.value


def format_value(value: Value) -> str:
    """Render a value the way a spreadsheet would: 30, not 30.0."""
    if isinstance(value, ErrorValue):
        return value.code
    return f"{value:.10g}"
