"""Recursive-descent parser for formulas.

    expression := term (('+' | '-') term)*
    term       := factor (('*' | '/') factor)*
    factor     := ('+' | '-') factor | primary
    primary    := NUMBER | '(' expression ')' | call | cell
    call       := NAME '(' (argument (',' argument)*)? ')'
    argument   := range | expression
    range      := cell ':' cell
    cell       := NAME                      (validated against A1:Z100)

``+``/``-`` and ``*``//`` are left associative because each is a loop rather
than a recursive call, so ``10-2-3`` is ``(10-2)-3`` and not ``10-(2-3)``.
Unary signs bind tighter than binary ones and nest to the right: ``--5`` is 5.
"""

from __future__ import annotations

from typing import List, Optional

from .ast_nodes import (
    Argument,
    BinaryOp,
    Expr,
    FunctionCall,
    Literal,
    RangeRef,
    Reference,
    UnaryOp,
)
from .errors import ParseError
from .lexer import Token, TokenType, tokenize
from . import functions
from .reference import CellRef

# Guards against a stack overflow on pathological input such as "=((((((1))))))"
# repeated a few thousand times.  Real formulas never come close.
MAX_NESTING_DEPTH = 64


def parse_formula(source: str) -> Expr:
    """Compile the text of a formula (with or without the leading ``=``)."""
    body = source.strip()
    if body.startswith("="):
        body = body[1:]
    if not body.strip():
        raise ParseError("empty formula")
    return _Parser(tokenize(body)).parse()


class _Parser:
    def __init__(self, tokens: List[Token]) -> None:
        self._tokens = tokens
        self._pos = 0
        self._depth = 0

    def parse(self) -> Expr:
        node = self._expression()
        self._expect(TokenType.EOF)
        return node

    # -- token helpers ----------------------------------------------------
    def _peek(self, offset: int = 0) -> Token:
        index = min(self._pos + offset, len(self._tokens) - 1)
        return self._tokens[index]

    def _advance(self) -> Token:
        token = self._peek()
        if token.type is not TokenType.EOF:
            self._pos += 1
        return token

    def _match(self, *types: TokenType) -> Optional[Token]:
        if self._peek().type in types:
            return self._advance()
        return None

    def _expect(self, type_: TokenType) -> Token:
        token = self._peek()
        if token.type is not type_:
            raise ParseError(
                f"expected {type_.value} but found {self._describe(token)}"
            )
        return self._advance()

    @staticmethod
    def _describe(token: Token) -> str:
        if token.type is TokenType.EOF:
            return "end of formula"
        return f"{token.text!r} at position {token.position}"

    def _enter(self) -> None:
        self._depth += 1
        if self._depth > MAX_NESTING_DEPTH:
            raise ParseError(
                f"formula nests deeper than {MAX_NESTING_DEPTH} levels"
            )

    # -- grammar ----------------------------------------------------------
    def _expression(self) -> Expr:
        self._enter()
        try:
            node = self._term()
            while (op := self._match(TokenType.PLUS, TokenType.MINUS)) is not None:
                node = BinaryOp(op.text, node, self._term())
            return node
        finally:
            self._depth -= 1

    def _term(self) -> Expr:
        node = self._factor()
        while (op := self._match(TokenType.STAR, TokenType.SLASH)) is not None:
            node = BinaryOp(op.text, node, self._factor())
        return node

    def _factor(self) -> Expr:
        op = self._match(TokenType.PLUS, TokenType.MINUS)
        if op is None:
            return self._primary()
        self._enter()
        try:
            return UnaryOp(op.text, self._factor())
        finally:
            self._depth -= 1

    def _primary(self) -> Expr:
        token = self._advance()
        if token.type is TokenType.NUMBER:
            return Literal(float(token.text))
        if token.type is TokenType.LPAREN:
            node = self._expression()
            self._expect(TokenType.RPAREN)
            return node
        if token.type is TokenType.IDENT:
            if self._peek().type is TokenType.LPAREN:
                return self._call(token)
            if self._peek().type is TokenType.COLON:
                raise ParseError(
                    "a range is only allowed as a function argument, "
                    "e.g. SUM(A1:A10)"
                )
            return Reference(self._cell(token))
        raise ParseError(f"unexpected {self._describe(token)}")

    def _call(self, name: Token) -> Expr:
        function = functions.lookup(name.text)
        self._expect(TokenType.LPAREN)
        args: List[Argument] = []
        if self._peek().type is not TokenType.RPAREN:
            args.append(self._argument())
            while self._match(TokenType.COMMA) is not None:
                args.append(self._argument())
        self._expect(TokenType.RPAREN)
        return FunctionCall(name.text.upper(), function, tuple(args))

    def _argument(self) -> Argument:
        if (
            self._peek().type is TokenType.IDENT
            and self._peek(1).type is TokenType.COLON
        ):
            start = self._advance()
            self._advance()  # ':'
            end = self._expect(TokenType.IDENT)
            return RangeRef(self._cell(start), self._cell(end))
        return self._expression()

    def _cell(self, token: Token) -> CellRef:
        try:
            return CellRef.parse(token.text)
        except ParseError as exc:
            raise ParseError(f"{exc} (position {token.position})") from None
