"""Behaviour tests for the engine: values, propagation, cycles, caching."""

import unittest

from spreadsheet import (
    CircularReferenceError,
    ErrorValue,
    ParseError,
    Spreadsheet,
    format_value,
)
from spreadsheet.errors import CYCLE, DIV_ZERO, NUM


class SheetTestCase(unittest.TestCase):
    def setUp(self):
        self.sheet = Spreadsheet()

    def set(self, **cells):
        for name, raw in cells.items():
            self.sheet.set_cell(name, raw)

    def value(self, name):
        return self.sheet.get_value(name)

    def assertCell(self, name, expected):
        self.assertAlmostEqual(self.value(name), expected, places=9)

    def assertError(self, name, code):
        value = self.value(name)
        self.assertIsInstance(value, ErrorValue, f"{name} = {value!r}")
        self.assertEqual(value.code, code)


class TestTheBriefTranscript(SheetTestCase):
    def test_transcript(self):
        self.set(A1="10", A2="20", A3="=A1+A2")
        self.assertCell("A3", 30)
        self.set(A1="50")
        self.assertCell("A3", 70)


class TestArithmetic(SheetTestCase):
    def test_precedence(self):
        self.set(A1="=2+3*4")
        self.assertCell("A1", 14)

    def test_parentheses(self):
        self.set(A1="=(2+3)*4")
        self.assertCell("A1", 20)

    def test_subtraction_is_left_associative(self):
        self.set(A1="=10-2-3")
        self.assertCell("A1", 5)

    def test_division_is_left_associative(self):
        self.set(A1="=100/10/2")
        self.assertCell("A1", 5)

    def test_unary_minus_binds_tighter_than_binary(self):
        self.set(A1="4", B1="=-A1+10")
        self.assertCell("B1", 6)

    def test_repeated_unary_signs(self):
        self.set(A1="=--5", B1="=-+-2")
        self.assertCell("A1", 5)
        self.assertCell("B1", 2)

    def test_reference_inside_nested_expression(self):
        self.set(A1="3", B2="7", C1="=A1*(B2+3)")
        self.assertCell("C1", 30)

    def test_number_literal_forms(self):
        self.set(A1="-2.5", A2="=.5+1e2+2.")
        self.assertCell("A1", -2.5)
        self.assertCell("A2", 102.5)

    def test_whitespace_and_case_are_ignored(self):
        self.set(A1="10")
        self.sheet.set_cell("a2", "=  a1  *   2 ")
        self.assertCell("A2", 20)


class TestBlankCells(SheetTestCase):
    def test_blank_cell_reads_as_zero(self):
        self.assertCell("Z100", 0)
        self.set(A1="=Z100+5")
        self.assertCell("A1", 5)

    def test_formula_written_before_its_inputs(self):
        self.set(A3="=A1+A2")
        self.assertCell("A3", 0)
        self.set(A1="4", A2="6")
        self.assertCell("A3", 10)

    def test_deleting_a_cell_updates_dependents(self):
        self.set(A1="10", A2="=A1+1")
        self.assertCell("A2", 11)
        self.sheet.clear_cell("A1")
        self.assertCell("A2", 1)
        self.assertEqual(self.sheet.formula_of("A1"), "")


class TestPropagation(SheetTestCase):
    def test_transitive_propagation(self):
        self.set(A1="1", A2="=A1*2", A3="=A2*2", A4="=A3*2")
        self.assertCell("A4", 8)
        self.set(A1="10")
        self.assertCell("A4", 80)

    def test_diamond_dependency_is_consistent(self):
        self.set(A1="2", B1="=A1*3", C1="=A1*5", D1="=B1+C1")
        self.assertCell("D1", 16)
        self.set(A1="4")
        self.assertCell("D1", 32)

    def test_rewriting_a_formula_drops_the_old_edges(self):
        self.set(A1="1", A2="100", A3="=A1+A2")
        self.assertCell("A3", 101)
        self.set(A3="=A1")
        self.assertEqual(self.sheet.dependents_of("A2"), [])
        self.set(A2="999")
        self.assertCell("A3", 1)

    def test_long_chain_does_not_hit_the_recursion_limit(self):
        length = 1500
        self.sheet.set_cell("A1", "1")
        names = [f"{chr(ord('A') + i // 100)}{i % 100 + 1}" for i in range(length)]
        previous = "A1"
        for name in names:
            if name == "A1":
                continue
            self.sheet.set_cell(name, f"={previous}+1")
            previous = name
        self.assertCell(previous, length)
        self.sheet.set_cell("A1", "1001")
        self.assertCell(previous, length + 1000)


class TestCycles(SheetTestCase):
    def test_direct_self_reference(self):
        with self.assertRaises(CircularReferenceError):
            self.sheet.set_cell("A1", "=A1+1")

    def test_three_cell_cycle_is_reported_with_its_chain(self):
        self.set(A1="=B1+1", B1="=C1+1")
        with self.assertRaises(CircularReferenceError) as caught:
            self.sheet.set_cell("C1", "=A1+1")
        self.assertEqual(
            [str(ref) for ref in caught.exception.cycle], ["C1", "A1", "B1", "C1"]
        )

    def test_rejected_write_leaves_the_sheet_untouched(self):
        self.set(A1="5", B1="=A1+1")
        with self.assertRaises(CircularReferenceError):
            self.sheet.set_cell("A1", "=B1+1")
        self.assertEqual(self.sheet.formula_of("A1"), "5")
        self.assertCell("A1", 5)
        self.assertCell("B1", 6)
        self.set(A1="9")
        self.assertCell("B1", 10)

    def test_cycle_through_a_range(self):
        with self.assertRaises(CircularReferenceError):
            self.sheet.set_cell("A2", "=SUM(A1:A3)")

    def test_shared_precedent_is_not_a_cycle(self):
        self.set(A1="1", B1="=A1", C1="=A1", D1="=B1+C1+A1")
        self.assertCell("D1", 3)

    def test_a_cycle_can_be_broken_and_rebuilt(self):
        self.set(A1="=B1+1", B1="2")
        with self.assertRaises(CircularReferenceError):
            self.sheet.set_cell("B1", "=A1")
        self.set(B1="10")
        self.assertCell("A1", 11)


class TestErrorValues(SheetTestCase):
    def test_division_by_zero(self):
        self.set(A1="1", A2="0", A3="=A1/A2")
        self.assertError("A3", DIV_ZERO)

    def test_errors_propagate_and_then_recover(self):
        self.set(A1="1", A2="0", A3="=A1/A2", A4="=A3+1", A5="=A4*2")
        self.assertError("A5", DIV_ZERO)
        self.set(A2="2")
        self.assertCell("A5", 3)

    def test_overflow_becomes_a_number_error(self):
        self.set(A1="1e308", A2="=A1*10")
        self.assertError("A2", NUM)

    def test_error_code_is_never_the_internal_cycle_backstop(self):
        self.set(A1="1", A2="0", A3="=A1/A2")
        self.assertNotEqual(self.value("A3").code, CYCLE)


class TestFunctions(SheetTestCase):
    def fill_column(self, column, values, first_row=1):
        for offset, value in enumerate(values):
            self.sheet.set_cell(f"{column}{first_row + offset}", str(value))

    def test_sum_over_a_range(self):
        self.fill_column("B", range(1, 11))
        self.set(A1="=SUM(B1:B10)")
        self.assertCell("A1", 55)

    def test_avg_ignores_blank_cells(self):
        self.fill_column("C", [10, 20, 30])
        self.set(A2="=AVG(C1:C20)")
        self.assertCell("A2", 20)

    def test_sum_ignores_blank_cells(self):
        self.fill_column("C", [10, 20, 30])
        self.set(A2="=SUM(C1:C20)")
        self.assertCell("A2", 60)

    def test_filling_a_blank_inside_a_range_propagates(self):
        self.set(A1="=SUM(B1:B10)")
        self.assertCell("A1", 0)
        self.set(B7="5")
        self.assertCell("A1", 5)
        self.set(B7="6")
        self.assertCell("A1", 6)

    def test_avg_of_an_empty_range(self):
        self.set(A1="=AVG(B1:B10)")
        self.assertError("A1", DIV_ZERO)

    def test_range_corners_may_be_given_in_any_order(self):
        self.fill_column("B", [1, 2, 3])
        self.set(A1="=SUM(B3:B1)")
        self.assertCell("A1", 6)

    def test_rectangular_range(self):
        self.set(A1="1", A2="2", B1="3", B2="4", C5="=SUM(A1:B2)")
        self.assertCell("C5", 10)

    def test_mixed_arguments_and_nesting(self):
        self.fill_column("B", [1, 2, 3])
        self.set(A1="10", C1="=SUM(B1:B3, 4, A1) * 2")
        self.assertCell("C1", 40)

    def test_min_max_count(self):
        self.fill_column("B", [4, -2, 9])
        self.set(A1="=MIN(B1:B10)", A2="=MAX(B1:B10)", A3="=COUNT(B1:B10)")
        self.assertCell("A1", -2)
        self.assertCell("A2", 9)
        self.assertCell("A3", 3)

    def test_error_inside_a_range_propagates(self):
        self.set(B1="1", B2="=B1/0", A1="=SUM(B1:B10)")
        self.assertError("A1", DIV_ZERO)

    def test_nested_function_calls(self):
        self.fill_column("B", [1, 2, 3])
        self.set(A1="=SUM(B1:B3) + AVG(B1:B3)")
        self.assertCell("A1", 8)


class TestCaching(SheetTestCase):
    def build(self):
        self.set(A1="1", A2="=A1+1", A3="=A2+1", Z1="100", Z2="=Z1+1")
        self.value("A3")
        self.value("Z2")

    def test_reading_twice_computes_once(self):
        self.build()
        before = self.sheet.recompute_count
        self.value("A3")
        self.value("A3")
        self.assertEqual(self.sheet.recompute_count, before)

    def test_unrelated_write_does_not_recompute(self):
        self.build()
        before = self.sheet.recompute_count
        self.set(Z1="200")
        self.value("A3")
        self.assertEqual(self.sheet.recompute_count, before)

    def test_write_recomputes_only_the_affected_cells(self):
        self.build()
        before = self.sheet.recompute_count
        self.set(A1="10")
        self.assertCell("A3", 12)
        self.assertEqual(self.sheet.recompute_count - before, 2)  # A2 and A3

    def test_reading_a_cell_does_not_compute_unrelated_stale_cells(self):
        self.set(A1="1", A2="=A1+1", B1="=A1+5", C1="=B1+5")
        self.value("A2")
        self.value("C1")
        before = self.sheet.recompute_count
        self.set(A1="2")
        self.value("A2")
        self.assertEqual(self.sheet.recompute_count - before, 1)  # only A2

    def test_repeated_writes_do_not_re_walk_the_dirty_subtree(self):
        self.set(A1="1")
        for row in range(2, 60):
            self.sheet.set_cell(f"A{row}", f"=A{row - 1}+1")
        self.value("A59")
        before = self.sheet.recompute_count
        for value in range(10):
            self.sheet.set_cell("A1", str(value))
        self.assertEqual(self.sheet.recompute_count, before)  # nothing read yet
        self.assertCell("A59", 67)
        self.assertEqual(self.sheet.recompute_count - before, 58)


class TestInvalidInput(SheetTestCase):
    def test_cell_names_outside_the_grid(self):
        for name in ("AA1", "A0", "A101", "1A", "A", "", "A1:A2"):
            with self.subTest(name=name), self.assertRaises(ParseError):
                self.sheet.set_cell(name, "1")

    def test_grid_corners_are_valid(self):
        self.set(A1="1", Z100="2")
        self.assertCell("Z100", 2)

    def test_reference_outside_the_grid_inside_a_formula(self):
        for formula in ("=AA1+1", "=A101", "=SUM(A1:A200)"):
            with self.subTest(formula=formula), self.assertRaises(ParseError):
                self.sheet.set_cell("B1", formula)

    def test_malformed_formulas(self):
        for formula in (
            "=1+",
            "=(1+2",
            "=1+2)",
            "=*3",
            "=SUM(A1:A3",
            "=A1:A3",
            "=A1 A2",
            "=",
            "=SUM(A1:)",
            "=1 $ 2",
        ):
            with self.subTest(formula=formula), self.assertRaises(ParseError):
                self.sheet.set_cell("B1", formula)

    def test_unknown_function(self):
        with self.assertRaises(ParseError):
            self.sheet.set_cell("A1", "=MEDIAN(B1:B9)")

    def test_text_without_an_equals_sign_is_not_a_value(self):
        with self.assertRaises(ParseError):
            self.sheet.set_cell("A1", "hello")

    def test_non_finite_literals_are_rejected(self):
        for literal in ("nan", "inf", "-inf"):
            with self.subTest(literal=literal), self.assertRaises(ParseError):
                self.sheet.set_cell("A1", literal)

    def test_deeply_nested_formula_is_rejected_not_crashed(self):
        formula = "=" + "(" * 500 + "1" + ")" * 500
        with self.assertRaises(ParseError):
            self.sheet.set_cell("A1", formula)

    def test_a_rejected_formula_leaves_no_dangling_edges(self):
        self.set(A1="1", B1="=A1+1")
        with self.assertRaises(ParseError):
            self.sheet.set_cell("B1", "=A1+")
        self.assertEqual(self.sheet.dependents_of("A1"), ["B1"])
        self.set(A1="5")
        self.assertCell("B1", 6)


class TestFormatting(SheetTestCase):
    def test_whole_numbers_have_no_decimal_point(self):
        self.set(A1="10", A2="20", A3="=A1+A2")
        self.assertEqual(format_value(self.value("A3")), "30")

    def test_fractions_are_readable(self):
        self.set(A1="=1/3")
        self.assertEqual(format_value(self.value("A1")), "0.3333333333")

    def test_float_noise_is_not_shown(self):
        self.set(A1="0.1", A2="0.2", A3="=A1+A2")
        self.assertEqual(format_value(self.value("A3")), "0.3")

    def test_errors_render_as_their_code(self):
        self.set(A1="=1/0")
        self.assertEqual(format_value(self.value("A1")), DIV_ZERO)


if __name__ == "__main__":
    unittest.main()
