"""Cell addresses and rectangular ranges for the fixed A1:Z100 grid."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List

from .errors import ParseError

FIRST_COLUMN = "A"
LAST_COLUMN = "Z"
MIN_ROW = 1
MAX_ROW = 100

_CELL_RE = re.compile(r"\A([A-Za-z])([0-9]{1,3})\Z")


@dataclass(frozen=True, order=True)
class CellRef:
    """A single cell.  ``col`` is 0-based (A == 0); ``row`` is 1-based."""

    col: int
    row: int

    @classmethod
    def parse(cls, text: str) -> "CellRef":
        match = _CELL_RE.match(text.strip())
        if match is None:
            raise ParseError(
                f"{text.strip()!r} is not a cell name "
                f"(expected {FIRST_COLUMN}{MIN_ROW}..{LAST_COLUMN}{MAX_ROW})"
            )
        column, row = match.group(1).upper(), int(match.group(2))
        if not MIN_ROW <= row <= MAX_ROW:
            raise ParseError(
                f"{text.strip().upper()!r} is outside the sheet: row must be "
                f"{MIN_ROW}..{MAX_ROW}"
            )
        return cls(ord(column) - ord(FIRST_COLUMN), row)

    @property
    def name(self) -> str:
        return f"{chr(ord(FIRST_COLUMN) + self.col)}{self.row}"

    def __str__(self) -> str:
        return self.name


def cells_in_range(start: CellRef, end: CellRef) -> List[CellRef]:
    """Every cell of the rectangle spanned by two corners.

    The corners may be given in any order, so ``B10:B1`` and ``C3:A1`` are the
    same ranges as ``B1:B10`` and ``A1:C3``.
    """
    first_col, last_col = sorted((start.col, end.col))
    first_row, last_row = sorted((start.row, end.row))
    return [
        CellRef(col, row)
        for col in range(first_col, last_col + 1)
        for row in range(first_row, last_row + 1)
    ]
