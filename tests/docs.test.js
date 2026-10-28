import test from "node:test";
import assert from "node:assert/strict";
import { documentText, findOccurrences } from "../src/docs.js";

const para = (...runs) => ({ paragraph: { elements: runs.map((content) => ({ textRun: { content } })) } });

test("documentText joins paragraphs and walks into tables and tables of contents", () => {
  const doc = {
    body: {
      content: [
        { sectionBreak: {} },
        para("Title\n"),
        para("Hello ", "world\n"),
        {
          table: { tableRows: [{ tableCells: [{ content: [para("A1\n")] }, { content: [para("B1\n")] }] }] },
        },
        { tableOfContents: { content: [para("Contents\n")] } },
        { paragraph: { elements: [{ inlineObjectElement: {} }] } },
      ],
    },
  };
  assert.equal(documentText(doc), "Title\nHello world\nA1\nB1\nContents\n");
  assert.equal(documentText({}), "");
});

test("findOccurrences counts every match and shows context with the match marked", () => {
  const text = "The cat sat.\nThe CAT ran. A cat!";
  const exact = findOccurrences(text, "cat", { context: 4 });
  assert.equal(exact.count, 2);
  assert.deepEqual(exact.snippets, ["The [[cat]] sat", ". A [[cat]]!"]);
  assert.equal(findOccurrences(text, "cat", { matchCase: false }).count, 3);
});

test("findOccurrences doesn't double-count overlapping matches, caps snippets, and rejects empty find", () => {
  assert.equal(findOccurrences("aaaa", "aa").count, 2);
  const many = findOccurrences("x ".repeat(20), "x", { limit: 3 });
  assert.equal(many.count, 20);
  assert.equal(many.snippets.length, 3);
  assert.throws(() => findOccurrences("abc", ""), /must not be empty/);
});
