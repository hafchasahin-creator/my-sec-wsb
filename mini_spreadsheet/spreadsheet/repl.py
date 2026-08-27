"""The command interpreter: SET / GET / DEL / LIST / FORMULA / HELP / EXIT.

Kept deliberately thin -- it translates lines to ``Spreadsheet`` calls and
formats the answers.  Every rule about cells, formulas and dependencies lives
in the engine, so the sheet is equally usable as a library.
"""

from __future__ import annotations

import os
import sys
from typing import IO, List, Optional

from .engine import Spreadsheet, format_value
from .errors import SpreadsheetError
from . import functions

PROMPT = "sheet> "

HELP = f"""\
commands (case-insensitive):
  SET <cell> <number>     SET A1 10
  SET <cell> =<formula>   SET A3 =A1*(B2+3)
  GET <cell>              print the cell's value
  DEL <cell>              blank the cell
  FORMULA <cell>          print what was typed into the cell
  DEPS <cell>             cells that read this one directly
  LIST                    every non-blank cell
  HELP / EXIT
cells run A1..Z100; operators + - * / and parentheses
functions: {', '.join(functions.names())} over ranges, e.g. =SUM(B1:B10)"""


def run(
    source: IO[str],
    out: IO[str],
    sheet: Optional[Spreadsheet] = None,
    interactive: bool = False,
) -> Spreadsheet:
    """Read commands until EOF or EXIT.  Returns the sheet, for tests."""
    sheet = sheet if sheet is not None else Spreadsheet()
    while True:
        if interactive:
            out.write(PROMPT)
            out.flush()
        line = source.readline()
        if not line:  # EOF
            return sheet
        try:
            if not _execute(sheet, line, out):
                return sheet
        except SpreadsheetError as exc:
            out.write(f"! {exc}\n")
        out.flush()


def _execute(sheet: Spreadsheet, line: str, out: IO[str]) -> bool:
    """Run one command.  Returns False when the session should end."""
    text = line.strip()
    if not text or text.startswith("#"):
        return True

    parts = text.split(None, 2)
    command = parts[0].upper()
    args = parts[1:]

    if command in ("EXIT", "QUIT"):
        return False
    if command == "HELP":
        out.write(HELP + "\n")
        return True
    if command == "LIST":
        rows = list(sheet.filled_cells())
        if not rows:
            out.write("> (empty sheet)\n")
        for name, raw, value in rows:
            shown = f"{name}: {format_value(value)}"
            out.write(f"> {shown}   [{raw}]\n" if raw.startswith("=") else f"> {shown}\n")
        return True

    if command == "SET":
        if len(args) != 2:
            raise _usage("SET <cell> <number|=formula>")
        sheet.set_cell(args[0], args[1])
        return True
    if command in ("GET", "DEL", "CLEAR", "FORMULA", "DEPS"):
        if len(args) != 1:
            raise _usage(f"{command} <cell>")
        if command == "GET":
            out.write(f"> {format_value(sheet.get_value(args[0]))}\n")
        elif command == "FORMULA":
            out.write(f"> {sheet.formula_of(args[0]) or '(blank)'}\n")
        elif command == "DEPS":
            out.write(f"> {', '.join(sheet.dependents_of(args[0])) or '(none)'}\n")
        else:
            sheet.clear_cell(args[0])
        return True

    raise _usage_unknown(command)


def _usage(form: str) -> SpreadsheetError:
    return SpreadsheetError(f"usage: {form}")


def _usage_unknown(command: str) -> SpreadsheetError:
    return SpreadsheetError(f"unknown command {command!r}; try HELP")


def main(argv: Optional[List[str]] = None) -> int:
    """``python -m spreadsheet [script]`` -- a script file, or stdin."""
    argv = list(sys.argv[1:] if argv is None else argv)
    try:
        if argv:
            with open(argv[0], "r", encoding="utf-8") as handle:
                run(handle, sys.stdout)
        else:
            run(sys.stdin, sys.stdout, interactive=sys.stdin.isatty())
    except KeyboardInterrupt:
        sys.stdout.write("\n")
        return 130
    except BrokenPipeError:
        # Downstream (`| head`) stopped reading; silence the interpreter's
        # shutdown flush so the pipeline stays quiet.
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        return 0
    except OSError as exc:
        sys.stderr.write(f"! {exc}\n")
        return 1
    return 0
