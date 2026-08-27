"""Error types shared by the parser and the evaluation engine.

Two distinct kinds of failure exist in a spreadsheet, and conflating them is a
common source of bugs:

* A *command* can be invalid -- a malformed formula, an unknown cell, an
  assignment that would create a cycle.  The sheet is left untouched and the
  caller is told why (``ParseError`` / ``CircularReferenceError``).
* A *value* can be invalid -- dividing by zero, averaging nothing.  That is not
  a failed command: the cell is set, it simply holds an error which propagates
  to everything downstream, exactly like ``#DIV/0!`` in Excel.  Those live as
  ``ErrorValue`` instances and travel during evaluation as ``EvaluationError``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

# Error codes that can end up stored in a cell.
DIV_ZERO = "#DIV/0!"
NUM = "#NUM!"
CYCLE = "#CYCLE!"


class SpreadsheetError(Exception):
    """Base class for every error the engine reports to a caller."""


class ParseError(SpreadsheetError):
    """A cell name, literal or formula is not well formed."""


class CircularReferenceError(SpreadsheetError):
    """An assignment would have made a cell depend on itself."""

    def __init__(self, cycle: Sequence["object"]) -> None:
        self.cycle = tuple(cycle)
        chain = " -> ".join(str(ref) for ref in self.cycle)
        super().__init__(f"circular reference: {chain}")


@dataclass(frozen=True)
class ErrorValue:
    """An error that lives *inside* a cell and propagates to its dependents."""

    code: str
    detail: str = ""

    def __str__(self) -> str:
        return self.code


class EvaluationError(SpreadsheetError):
    """Raised while evaluating; carries the ``ErrorValue`` the cell will hold."""

    def __init__(self, value: ErrorValue) -> None:
        self.value = value
        super().__init__(f"{value.code} {value.detail}".strip())
