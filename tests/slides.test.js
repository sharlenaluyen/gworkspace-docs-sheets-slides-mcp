import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

// slides.js imports files.js, which reads its folder from the environment -
// point it at a throwaway directory, never the real ~/Downloads.
process.env.GWORKSPACE_MCP_FILES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gws-slides-"));

const {
  shapeText,
  summarizePresentation,
  findElement,
  newObjectId,
  buildAddSlideRequests,
  buildReplaceShapeTextRequests,
  LAYOUTS,
} = await import("../src/slides.js");

const shape = (objectId, text, placeholder) => ({
  objectId,
  shape: {
    ...(placeholder ? { placeholder: { type: placeholder } } : {}),
    text: { textElements: [{ paragraphMarker: {} }, { textRun: { content: text } }] },
  },
});

const deck = {
  slides: [
    {
      objectId: "s1",
      pageElements: [
        shape("t1", "Welcome\n", "TITLE"),
        { objectId: "img", image: {} },
        shape("empty", ""),
        {
          objectId: "g1",
          elementGroup: { children: [shape("nested", "Inside a group\n")] },
        },
      ],
      slideProperties: {
        notesPage: {
          notesProperties: { speakerNotesObjectId: "n1" },
          pageElements: [shape("n1", "Say hi\n")],
        },
      },
    },
    {
      objectId: "s2",
      pageElements: [
        {
          objectId: "tbl",
          table: {
            tableRows: [{ tableCells: [shape("", "A\n").shape, shape("", "B\n").shape] }],
          },
        },
      ],
    },
  ],
};

test("shapeText joins a shape's text runs", () => {
  assert.equal(shapeText(deck.slides[0].pageElements[0].shape), "Welcome\n");
  assert.equal(shapeText(undefined), "");
});

test("summarizePresentation lists text shapes (including grouped ones), tables and notes, as untrusted", () => {
  const [s1, s2] = summarizePresentation(deck);
  assert.equal(s1.object_id, "s1");
  assert.deepEqual(
    s1.elements.map((e) => [e.object_id, e.kind, e.placeholder]),
    [
      ["t1", "shape", "TITLE"],
      ["nested", "shape", undefined],
    ]
  );
  assert.match(s1.elements[0].text, /^<untrusted_document_content>\nWelcome\n/);
  assert.match(s1.speaker_notes, /Say hi/);
  assert.equal(s2.elements[0].kind, "table");
  assert.match(s2.elements[0].text, /A \| B/);
  assert.equal(s2.speaker_notes, undefined);
});

test("findElement finds shapes inside groups and reports their slide", () => {
  assert.equal(findElement(deck, "nested").slideIndex, 0);
  assert.equal(findElement(deck, "tbl").slideIndex, 1);
  assert.equal(findElement(deck, "nope"), null);
});

test("newObjectId fits Slides' id rules (5-50 chars, starts with a letter)", () => {
  const id = newObjectId("slide");
  assert.match(id, /^[A-Za-z][A-Za-z0-9_-]{4,49}$/);
  assert.notEqual(id, newObjectId("slide"));
});

test("buildAddSlideRequests maps title/body into the layout's placeholders", () => {
  const { requests, slideId } = buildAddSlideRequests(
    { layout: "TITLE", title: "Hello", body: "Sub", insertion_index: 2 },
    { slide: "s_x", title: "t_x", body: "b_x" }
  );
  assert.equal(slideId, "s_x");
  assert.deepEqual(requests[0].createSlide, {
    objectId: "s_x",
    insertionIndex: 2,
    slideLayoutReference: { predefinedLayout: "TITLE" },
    placeholderIdMappings: [
      { layoutPlaceholder: { type: "CENTERED_TITLE", index: 0 }, objectId: "t_x" },
      { layoutPlaceholder: { type: "SUBTITLE", index: 0 }, objectId: "b_x" },
    ],
  });
  assert.deepEqual(requests[1], { insertText: { objectId: "t_x", insertionIndex: 0, text: "Hello" } });
  assert.equal(requests.length, 3);
});

test("buildAddSlideRequests refuses text the layout has nowhere to put, and unknown layouts", () => {
  assert.throws(() => buildAddSlideRequests({ layout: "BLANK", title: "x" }), /no title placeholder/);
  assert.throws(() => buildAddSlideRequests({ layout: "TITLE_ONLY", body: "x" }), /no body placeholder/);
  assert.throws(() => buildAddSlideRequests({ layout: "FANCY" }), /Unsupported layout/);
  const blank = buildAddSlideRequests({ layout: "BLANK" });
  assert.equal(blank.requests.length, 1);
  assert.equal(blank.requests[0].createSlide.placeholderIdMappings, undefined);
  assert.ok(Object.keys(LAYOUTS).includes("TITLE_AND_BODY"));
});

test("buildReplaceShapeTextRequests only deletes when there's text to delete", () => {
  assert.deepEqual(buildReplaceShapeTextRequests("o", "Old\n", "New"), [
    { deleteText: { objectId: "o", textRange: { type: "ALL" } } },
    { insertText: { objectId: "o", insertionIndex: 0, text: "New" } },
  ]);
  assert.deepEqual(buildReplaceShapeTextRequests("o", "\n", "New"), [
    { insertText: { objectId: "o", insertionIndex: 0, text: "New" } },
  ]);
  assert.deepEqual(buildReplaceShapeTextRequests("o", "Old", ""), [
    { deleteText: { objectId: "o", textRange: { type: "ALL" } } },
  ]);
});
