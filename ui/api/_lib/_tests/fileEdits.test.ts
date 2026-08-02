import { describe, it, expect } from "vitest";
import { applyStringEdits, applyJsonMergePatch } from "../fileEdits.js";

describe("applyStringEdits", () => {
  it("applies a single unique match", () => {
    const result = applyStringEdits("Hello world", [{ old_string: "world", new_string: "there" }]);
    expect(result.content).toBe("Hello there");
    expect(result.failed).toEqual([]);
  });

  it("applies multiple edits in sequence, each against the previous result", () => {
    const result = applyStringEdits("a b c", [
      { old_string: "a", new_string: "x" },
      { old_string: "x b", new_string: "x y" },
    ]);
    expect(result.content).toBe("x y c");
    expect(result.failed).toEqual([]);
  });

  it("skips (not throws) an edit whose old_string isn't found", () => {
    const result = applyStringEdits("Hello world", [{ old_string: "goodbye", new_string: "hi" }]);
    expect(result.content).toBe("Hello world");
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].old_string).toBe("goodbye");
  });

  it("skips an edit whose old_string is ambiguous (appears more than once)", () => {
    const result = applyStringEdits("cat cat cat", [{ old_string: "cat", new_string: "dog" }]);
    expect(result.content).toBe("cat cat cat");
    expect(result.failed).toHaveLength(1);
  });

  it("skips an edit with an empty old_string rather than matching everywhere", () => {
    const result = applyStringEdits("hello", [{ old_string: "", new_string: "x" }]);
    expect(result.content).toBe("hello");
    expect(result.failed).toHaveLength(1);
  });

  it("one failed edit doesn't block other genuinely-valid edits in the same call", () => {
    const result = applyStringEdits("alpha beta gamma", [
      { old_string: "nonexistent", new_string: "x" },
      { old_string: "beta", new_string: "BETA" },
    ]);
    expect(result.content).toBe("alpha BETA gamma");
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].old_string).toBe("nonexistent");
  });

  it("a later edit can target text introduced by an earlier edit in the same call", () => {
    const result = applyStringEdits("original", [
      { old_string: "original", new_string: "intermediate" },
      { old_string: "intermediate", new_string: "final" },
    ]);
    expect(result.content).toBe("final");
    expect(result.failed).toEqual([]);
  });

  it("no-ops on an empty edits array", () => {
    const result = applyStringEdits("unchanged", []);
    expect(result.content).toBe("unchanged");
    expect(result.failed).toEqual([]);
  });
});

describe("applyJsonMergePatch", () => {
  it("adds a new key to an existing object", () => {
    const result = applyJsonMergePatch('{"a":1}', '{"b":2}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(result.content)).toEqual({ a: 1, b: 2 });
  });

  it("overwrites an existing key's value", () => {
    const result = applyJsonMergePatch('{"a":1,"b":2}', '{"a":99}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(result.content)).toEqual({ a: 99, b: 2 });
  });

  it("deletes a key when the patch sets it to null (RFC 7396)", () => {
    const result = applyJsonMergePatch('{"a":1,"b":2}', '{"b":null}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(result.content)).toEqual({ a: 1 });
  });

  it("merges nested objects recursively instead of replacing them wholesale", () => {
    const result = applyJsonMergePatch('{"outer":{"x":1,"y":2}}', '{"outer":{"y":99}}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(result.content)).toEqual({ outer: { x: 1, y: 99 } });
  });

  it("replaces an array wholesale rather than merging elements", () => {
    const result = applyJsonMergePatch('{"list":[1,2,3]}', '{"list":[9]}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(result.content)).toEqual({ list: [9] });
  });

  it("treats a null current file as an empty object - patch alone creates the file", () => {
    const result = applyJsonMergePatch(null, '{"a":1}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(result.content)).toEqual({ a: 1 });
  });

  it("rejects an invalid patch JSON string", () => {
    const result = applyJsonMergePatch('{"a":1}', "{not valid json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not valid JSON/);
  });

  it("rejects when current file content isn't valid JSON", () => {
    const result = applyJsonMergePatch("not json at all", '{"a":1}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/current file content/);
  });

  it("a top-level non-object, non-null patch value replaces the whole document", () => {
    // Per RFC 7396: if the patch itself isn't an object, the result is just the patch value.
    const result = applyJsonMergePatch('{"a":1}', '"just a string"');
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(result.content)).toBe("just a string");
  });
});
