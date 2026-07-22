import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

function normalizeStateBuffer(state) {
  if (!state) return null;
  if (state instanceof ArrayBuffer) return state;
  if (ArrayBuffer.isView(state)) return state.buffer;
  try {
    return new Uint8Array(state).buffer;
  } catch {
    return null;
  }
}

function toUint8Array(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) return new Uint8Array(data);
  return null;
}

function migrateVmPath(vmPath, mode) {
  if (vmPath.startsWith("/upload/") && mode === "terminal") return "/tmp/" + vmPath.slice(8);
  if (vmPath.startsWith("/upload/") && mode === "gui") return "/" + vmPath.slice(8);
  return vmPath;
}

describe("normalizeStateBuffer", () => {
  it("returns null for falsy input", () => {
    assert.equal(normalizeStateBuffer(null), null);
    assert.equal(normalizeStateBuffer(undefined), null);
    assert.equal(normalizeStateBuffer(0), null);
  });

  it("returns ArrayBuffer as-is", () => {
    const buf = new ArrayBuffer(8);
    assert.equal(normalizeStateBuffer(buf), buf);
  });

  it("extracts buffer from ArrayBufferView", () => {
    const arr = new Uint8Array([1, 2, 3]);
    const result = normalizeStateBuffer(arr);
    assert.ok(result instanceof ArrayBuffer);
    assert.equal(result.byteLength, 3);
  });

  it("converts array-like to ArrayBuffer", () => {
    const result = normalizeStateBuffer([1, 2, 3]);
    assert.ok(result instanceof ArrayBuffer);
    assert.equal(result.byteLength, 3);
  });

  it("returns null for unsupported types", () => {
    assert.equal(normalizeStateBuffer(null), null);
    assert.equal(normalizeStateBuffer(undefined), null);
  });

  it("attempts conversion for number input", () => {
    const result = normalizeStateBuffer(42);
    assert.ok(result instanceof ArrayBuffer);
    assert.equal(result.byteLength, 42);
  });
});

describe("toUint8Array", () => {
  it("returns Uint8Array as-is", () => {
    const arr = new Uint8Array([1, 2]);
    assert.equal(toUint8Array(arr), arr);
  });

  it("wraps ArrayBuffer", () => {
    const buf = new ArrayBuffer(4);
    const result = toUint8Array(buf);
    assert.ok(result instanceof Uint8Array);
    assert.equal(result.byteLength, 4);
  });

  it("wraps DataView", () => {
    const buf = new ArrayBuffer(4);
    const dv = new DataView(buf);
    const result = toUint8Array(dv);
    assert.ok(result instanceof Uint8Array);
    assert.equal(result.byteLength, 4);
  });

  it("converts plain array", () => {
    const result = toUint8Array([10, 20, 30]);
    assert.ok(result instanceof Uint8Array);
    assert.deepEqual([...result], [10, 20, 30]);
  });

  it("returns null for unsupported types", () => {
    assert.equal(toUint8Array("hello"), null);
    assert.equal(toUint8Array(42), null);
    assert.equal(toUint8Array(null), null);
  });
});

describe("migrateVmPath", () => {
  it("migrates /upload/ to /tmp/ in terminal mode", () => {
    assert.equal(migrateVmPath("/upload/file.txt", "terminal"), "/tmp/file.txt");
  });

  it("migrates /upload/ to / in gui mode", () => {
    assert.equal(migrateVmPath("/upload/file.txt", "gui"), "/file.txt");
  });

  it("leaves other paths unchanged", () => {
    assert.equal(migrateVmPath("/tmp/file.txt", "gui"), "/tmp/file.txt");
    assert.equal(migrateVmPath("/home/user/file", "terminal"), "/home/user/file");
  });
});
