"""Unit tests for the tokenizer and the recursive-descent parser.

These check the shape of the tree rather than the value it produces, so a
precedence bug is reported here instead of showing up as a wrong number.
"""

import unittest

from spreadsheet.ast_nodes import (
    BinaryOp,
    FunctionCall,
    Literal,
    RangeRef,
    Reference,
    UnaryOp,
)
from spreadsheet.errors import ParseError
from spreadsheet.lexer import TokenType, tokenize
from spreadsheet.parser import parse_formula
from spreadsheet.reference import CellRef, cells_in_range


class TestTokenizer(unittest.TestCase):
    def types(self, source):
        return [token.type for token in tokenize(source)]

    def test_operators_and_names(self):
        self.assertEqual(
            self.types("A1+2*(B2-3)"),
            [
                TokenType.IDENT,
                TokenType.PLUS,
                TokenType.NUMBER,
                TokenType.STAR,
                TokenType.LPAREN,
                TokenType.IDENT,
                TokenType.MINUS,
                TokenType.NUMBER,
                TokenType.RPAREN,
                TokenType.EOF,
            ],
        )

    def test_whitespace_is_insignificant(self):
        self.assertEqual(self.types("  A1  +  1 "), self.types("A1+1"))

    def test_number_shapes(self):
        for source in ("1", "1.", "1.5", ".5", "1e3", "2.5E-4"):
            with self.subTest(source=source):
                self.assertEqual(self.types(source), [TokenType.NUMBER, TokenType.EOF])

    def test_unknown_character_reports_its_position(self):
        with self.assertRaises(ParseError) as caught:
            tokenize("A1 $ 2")
        self.assertIn("position 3", str(caught.exception))


class TestParser(unittest.TestCase):
    def test_multiplication_binds_tighter_than_addition(self):
        tree = parse_formula("=1+2*3")
        self.assertEqual(tree, BinaryOp("+", Literal(1), BinaryOp("*", Literal(2), Literal(3))))

    def test_subtraction_nests_to_the_left(self):
        tree = parse_formula("=1-2-3")
        self.assertEqual(tree, BinaryOp("-", BinaryOp("-", Literal(1), Literal(2)), Literal(3)))

    def test_parentheses_override_precedence(self):
        tree = parse_formula("=(1+2)*3")
        self.assertEqual(tree, BinaryOp("*", BinaryOp("+", Literal(1), Literal(2)), Literal(3)))

    def test_unary_minus_applies_to_the_factor_only(self):
        tree = parse_formula("=-A1+1")
        self.assertEqual(
            tree, BinaryOp("+", UnaryOp("-", Reference(CellRef(0, 1))), Literal(1))
        )

    def test_leading_equals_is_optional(self):
        self.assertEqual(parse_formula("=A1"), parse_formula("A1"))

    def test_references_are_collected_from_the_whole_tree(self):
        tree = parse_formula("=A1*(B2+3)-C3")
        self.assertEqual(
            sorted(str(ref) for ref in tree.references()), ["A1", "B2", "C3"]
        )

    def test_a_range_expands_to_every_cell_it_covers(self):
        tree = parse_formula("=SUM(B1:B10)")
        self.assertIsInstance(tree, FunctionCall)
        self.assertEqual(tree.args, (RangeRef(CellRef(1, 1), CellRef(1, 10)),))
        self.assertEqual(len(list(tree.references())), 10)

    def test_function_names_are_case_insensitive(self):
        self.assertEqual(parse_formula("=sum(A1:A2)").name, "SUM")

    def test_a_range_is_rejected_outside_a_function(self):
        for formula in ("=A1:A3", "=1+A1:A3", "=SUM(A1:A3)+B1:B2"):
            with self.subTest(formula=formula), self.assertRaises(ParseError):
                parse_formula(formula)

    def test_error_messages_name_what_was_expected(self):
        with self.assertRaises(ParseError) as caught:
            parse_formula("=(1+2")
        self.assertIn("')'", str(caught.exception))


class TestCellRef(unittest.TestCase):
    def test_round_trip(self):
        for name in ("A1", "B7", "Z100", "M42"):
            with self.subTest(name=name):
                self.assertEqual(CellRef.parse(name).name, name)

    def test_lower_case_names_are_accepted(self):
        self.assertEqual(CellRef.parse("z100"), CellRef.parse("Z100"))

    def test_out_of_range_names(self):
        for name in ("AA1", "A0", "A101", "A1000", "1", "$A$1", " "):
            with self.subTest(name=name), self.assertRaises(ParseError):
                CellRef.parse(name)

    def test_range_expansion_is_order_independent(self):
        self.assertEqual(
            cells_in_range(CellRef.parse("C3"), CellRef.parse("A1")),
            cells_in_range(CellRef.parse("A1"), CellRef.parse("C3")),
        )
        self.assertEqual(len(cells_in_range(CellRef.parse("A1"), CellRef.parse("C3"))), 9)


if __name__ == "__main__":
    unittest.main()
