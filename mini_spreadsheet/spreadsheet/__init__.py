"""A small spreadsheet engine: formulas, dependency propagation, caching.

    >>> from spreadsheet import Spreadsheet
    >>> sheet = Spreadsheet()
    >>> sheet.set_cell("A1", "10")
    >>> sheet.set_cell("A2", "20")
    >>> sheet.set_cell("A3", "=A1+A2")
    >>> sheet.get_value("A3")
    30.0
    >>> sheet.set_cell("A1", "50")
    >>> sheet.get_value("A3")
    70.0
"""

from .engine import Cell, Spreadsheet, format_value
from .errors import (
    CircularReferenceError,
    ErrorValue,
    EvaluationError,
    ParseError,
    SpreadsheetError,
)
from .reference import CellRef

__all__ = [
    "Cell",
    "CellRef",
    "CircularReferenceError",
    "ErrorValue",
    "EvaluationError",
    "ParseError",
    "Spreadsheet",
    "SpreadsheetError",
    "format_value",
]
