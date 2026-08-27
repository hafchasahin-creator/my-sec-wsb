"""End-to-end tests for the command interpreter."""

import io
import unittest

from spreadsheet.repl import run


def session(script):
    out = io.StringIO()
    sheet = run(io.StringIO(script), out)
    return out.getvalue(), sheet


class TestRepl(unittest.TestCase):
    def test_the_transcript_from_the_brief(self):
        output, _ = session(
            """
            SET A1 10
            SET A2 20
            SET A3 =A1+A2
            GET A3
            SET A1 50
            GET A3
            """
        )
        self.assertEqual(output, "> 30\n> 70\n")

    def test_formulas_may_contain_spaces(self):
        output, _ = session("SET A1 3\nSET B1 = A1 * (2 + 4)\nGET B1\n")
        self.assertEqual(output, "> 18\n")

    def test_blank_lines_and_comments_are_ignored(self):
        output, _ = session("\n# a note\n\nSET A1 1\nGET A1\n")
        self.assertEqual(output, "> 1\n")

    def test_hard_mode_example(self):
        script = "".join(f"SET B{row} {row}\n" for row in range(1, 11))
        script += "".join(f"SET C{row} 2\n" for row in range(1, 21))
        script += "SET A1 =SUM(B1:B10)\nSET A2 =AVG(C1:C20)\nGET A1\nGET A2\n"
        output, _ = session(script)
        self.assertEqual(output, "> 55\n> 2\n")

    def test_a_bad_command_is_reported_and_the_session_continues(self):
        output, sheet = session("SET A1 =A1+1\nSET A1 5\nGET A1\n")
        self.assertIn("circular reference", output)
        self.assertTrue(output.endswith("> 5\n"))

    def test_errors_do_not_stop_the_script(self):
        output, _ = session("GET QQ9\nSET A1 oops\nFROBNICATE\nSET A1 2\nGET A1\n")
        lines = output.splitlines()
        self.assertEqual(len([line for line in lines if line.startswith("!")]), 3)
        self.assertEqual(lines[-1], "> 2")

    def test_exit_stops_reading(self):
        output, _ = session("SET A1 1\nGET A1\nEXIT\nGET A1\n")
        self.assertEqual(output, "> 1\n")

    def test_del_formula_deps_and_list(self):
        output, _ = session(
            "SET A1 2\nSET A2 =A1*3\nFORMULA A2\nDEPS A1\nLIST\nDEL A1\nGET A2\n"
        )
        self.assertEqual(
            output.splitlines(),
            ["> =A1*3", "> A2", "> A1: 2", "> A2: 6   [=A1*3]", "> 0"],
        )

    def test_get_on_a_blank_cell_reads_as_zero(self):
        output, _ = session("GET Z100\n")
        self.assertEqual(output, "> 0\n")

    def test_help_lists_the_commands(self):
        output, _ = session("HELP\n")
        self.assertIn("SET <cell>", output)
        self.assertIn("SUM", output)


if __name__ == "__main__":
    unittest.main()
