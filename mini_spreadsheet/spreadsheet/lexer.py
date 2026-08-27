"""Hand written tokenizer for formulas.  No regex-based parsing beyond the two
token shapes below, and no external parser library."""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from typing import List

from .errors import ParseError


class TokenType(Enum):
    NUMBER = "number"
    IDENT = "name"  # a cell reference (A1) or a function name (SUM)
    PLUS = "'+'"
    MINUS = "'-'"
    STAR = "'*'"
    SLASH = "'/'"
    LPAREN = "'('"
    RPAREN = "')'"
    COMMA = "','"
    COLON = "':'"
    EOF = "end of formula"


@dataclass(frozen=True)
class Token:
    type: TokenType
    text: str
    position: int  # 0-based offset into the formula, used in error messages


_SINGLE_CHARS = {
    "+": TokenType.PLUS,
    "-": TokenType.MINUS,
    "*": TokenType.STAR,
    "/": TokenType.SLASH,
    "(": TokenType.LPAREN,
    ")": TokenType.RPAREN,
    ",": TokenType.COMMA,
    ":": TokenType.COLON,
}

# 12, 12., 12.5, .5, 1e3, 2.5E-4
_NUMBER_RE = re.compile(r"(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")
_IDENT_RE = re.compile(r"[A-Za-z]+[0-9]*")


def tokenize(source: str) -> List[Token]:
    tokens: List[Token] = []
    index = 0
    while index < len(source):
        char = source[index]
        if char.isspace():
            index += 1
            continue
        if char in _SINGLE_CHARS:
            tokens.append(Token(_SINGLE_CHARS[char], char, index))
            index += 1
            continue
        match = _NUMBER_RE.match(source, index)
        if match and (char.isdigit() or char == "."):
            tokens.append(Token(TokenType.NUMBER, match.group(), index))
            index = match.end()
            continue
        match = _IDENT_RE.match(source, index)
        if match:
            tokens.append(Token(TokenType.IDENT, match.group(), index))
            index = match.end()
            continue
        raise ParseError(f"unexpected character {char!r} at position {index}")
    tokens.append(Token(TokenType.EOF, "", len(source)))
    return tokens
