"""The expression tree a formula compiles to.

Two things are asked of every node, and they are what the whole engine is built
on:

* ``evaluate(context)`` -- produce a value, reading other cells through the
  context so the node never needs to know about the sheet.
* ``references()`` -- the cells the node reads.  The engine turns that into the
  dependency graph, so nothing anywhere else has to re-derive it by scanning
  text.

Nodes are immutable: recomputing a cell never mutates its tree, which is what
makes caching safe.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Callable, Iterator, List, Sequence, Tuple, Union

from .errors import DIV_ZERO, ErrorValue, EvaluationError
from .reference import CellRef, cells_in_range


class EvalContext(ABC):
    """How an expression reads the rest of the sheet."""

    @abstractmethod
    def value_of(self, ref: CellRef) -> float:
        """Value of a single cell; a blank cell reads as 0."""

    @abstractmethod
    def values_in(self, refs: Sequence[CellRef]) -> List[float]:
        """Values of the non-blank cells among ``refs``, in order."""


class Expr(ABC):
    """An expression that evaluates to a single number."""

    @abstractmethod
    def evaluate(self, context: EvalContext) -> float: ...

    @abstractmethod
    def references(self) -> Iterator[CellRef]: ...


@dataclass(frozen=True)
class Literal(Expr):
    value: float

    def evaluate(self, context: EvalContext) -> float:
        return self.value

    def references(self) -> Iterator[CellRef]:
        return iter(())


@dataclass(frozen=True)
class Reference(Expr):
    ref: CellRef

    def evaluate(self, context: EvalContext) -> float:
        return context.value_of(self.ref)

    def references(self) -> Iterator[CellRef]:
        yield self.ref


@dataclass(frozen=True)
class UnaryOp(Expr):
    op: str
    operand: Expr

    def evaluate(self, context: EvalContext) -> float:
        value = self.operand.evaluate(context)
        return -value if self.op == "-" else value

    def references(self) -> Iterator[CellRef]:
        return self.operand.references()


@dataclass(frozen=True)
class BinaryOp(Expr):
    op: str
    left: Expr
    right: Expr

    def evaluate(self, context: EvalContext) -> float:
        left = self.left.evaluate(context)
        right = self.right.evaluate(context)
        if self.op == "+":
            return left + right
        if self.op == "-":
            return left - right
        if self.op == "*":
            return left * right
        if right == 0.0:
            raise EvaluationError(ErrorValue(DIV_ZERO, "division by zero"))
        return left / right

    def references(self) -> Iterator[CellRef]:
        yield from self.left.references()
        yield from self.right.references()


@dataclass(frozen=True)
class RangeRef:
    """``B1:B10``.  Not an ``Expr``: a range is a list of values, so it is only
    valid directly as a function argument, never as an operand of ``+``."""

    start: CellRef
    end: CellRef

    def cells(self) -> List[CellRef]:
        return cells_in_range(self.start, self.end)

    def evaluate(self, context: EvalContext) -> List[float]:
        return context.values_in(self.cells())

    def references(self) -> Iterator[CellRef]:
        # Every address in the rectangle, including the ones that are currently
        # blank -- filling one later has to invalidate the cells reading it.
        return iter(self.cells())

    def __str__(self) -> str:
        return f"{self.start}:{self.end}"


Argument = Union[Expr, RangeRef]


@dataclass(frozen=True)
class FunctionCall(Expr):
    name: str
    function: Callable[[List[float]], float]
    args: Tuple[Argument, ...]

    def evaluate(self, context: EvalContext) -> float:
        values: List[float] = []
        for arg in self.args:
            if isinstance(arg, RangeRef):
                values.extend(arg.evaluate(context))
            else:
                values.append(arg.evaluate(context))
        return self.function(values)

    def references(self) -> Iterator[CellRef]:
        for arg in self.args:
            yield from arg.references()
