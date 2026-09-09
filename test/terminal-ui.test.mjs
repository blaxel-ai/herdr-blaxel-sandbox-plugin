import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { stripVTControlCharacters } from "node:util";
import test from "node:test";
import stringWidth from "string-width";
import {
  TerminalUI,
  plainText,
  terminalFrame,
  fit,
} from "../src/terminal-ui.mjs";

function output() {
  return Object.assign(new EventEmitter(), {
    columns: 80,
    rows: 24,
    write() {},
  });
}

test("modal dims the background while keeping content readable at terminal width", () => {
  for (const width of [40, 80, 120]) {
    const modal = {
      title: "Choose a tool",
      lines: ["项目 👩‍💻", "e\u0301".repeat(100)],
      prompt: "Tool:",
      value: "",
      offset: 0,
    };
    const frame = terminalFrame(["Background 项目"], modal, width, 24);
    assert.ok(frame.includes("\u001b[2m"));
    assert.match(frame, /Choose a tool/);
    for (const row of frame.split("\n"))
      assert.equal(stringWidth(stripVTControlCharacters(row)), width);
  }
});

test("untrusted output cannot clear the screen or emit OSC links", () => {
  assert.equal(
    plainText(
      "safe\u001b[2J\u001b]8;;https://invalid.example\u0007link\u001b]8;;\u0007",
    ),
    "safelink",
  );
});

test("Escape cancels a modal, keys do not reach the dashboard, and focus returns", async () => {
  const keys = [];
  const terminal = new TerminalUI({
    output: output(),
    onKey: (key) => keys.push(key),
  });
  let answer;
  const task = terminal.modal("Delete", async (ui) => {
    answer = await ui.ask("Type DELETE:");
  });
  terminal.handleKey("d", { name: "d" });
  assert.deepEqual(keys, []);
  terminal.handleKey("\u001b", { name: "escape" });
  await task;
  assert.equal(answer, "");
  assert.equal(terminal.dialog, null);
  terminal.handleKey("n", { name: "n" });
  assert.deepEqual(keys, ["n"]);
});

test("long reviews scroll without submitting approval", async () => {
  const terminal = new TerminalUI({ output: output() });
  let answered = false;
  const task = terminal.modal("Review", async (ui) => {
    ui.write(Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n"));
    await ui.ask("Apply? [y/N]", { review: true });
    answered = true;
  });
  terminal.handleKey("", { name: "pagedown" });
  assert.ok(terminal.dialog.offset > 0);
  assert.equal(answered, false);
  terminal.handleKey("", { name: "escape" });
  await task;
});

test("a tiny terminal cannot confirm a hidden operation but can cancel it", async () => {
  const terminal = new TerminalUI({
    output: Object.assign(output(), { columns: 30, rows: 8 }),
  });
  let answer;
  const task = terminal.modal("Delete", async (ui) => {
    answer = await ui.ask("Type DELETE:");
  });
  terminal.handleKey("DELETE", {});
  terminal.handleKey("", { name: "return" });
  assert.equal(answer, undefined);
  assert.match(terminal.lastFrame, /Resize to 40 x 12/);
  terminal.handleKey("", { name: "escape" });
  await task;
  assert.equal(answer, "");
});

test("long input stays visible and Backspace removes one complete grapheme", async () => {
  const terminal = new TerminalUI({
    output: Object.assign(output(), { columns: 40 }),
  });
  let answer;
  const task = terminal.modal("Workspace", async (ui) => {
    answer = await ui.ask("Workspace, Esc to cancel:");
  });
  terminal.handleKey("long-workspace-name-👩‍💻", {});
  assert.match(terminal.lastFrame, /workspace-name-👩‍💻/);
  terminal.handleKey("", { name: "backspace" });
  assert.equal(terminal.dialog.value, "long-workspace-name-");
  terminal.handleKey("", { name: "return" });
  assert.equal(await task, true);
  assert.equal(answer, "long-workspace-name-");
  assert.equal(stringWidth(fit("项目👩‍💻", 5)), 5);
});

test("failed dialogs report failure after dismissal and restore the dashboard", async () => {
  const terminal = new TerminalUI({ output: output() });
  const task = terminal.modal("Apply", async () => {
    throw new Error("Patch conflict");
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(terminal.lastFrame, /Patch conflict/);
  terminal.handleKey("", { name: "escape" });
  assert.equal(await task, false);
  assert.equal(terminal.dialog, null);
});

test("scrolling reuses wrapped content and resizing or appended output invalidates it", () => {
  const modal = {
    title: "Review",
    lines: Array.from({ length: 100 }, () => "code line ".repeat(20)),
    prompt: "Apply?",
    value: "",
    offset: 0,
  };
  terminalFrame([], modal, 80, 24);
  const original = modal.wrapped;
  modal.offset = 10;
  terminalFrame([], modal, 80, 24);
  assert.equal(modal.wrapped, original);
  terminalFrame([], modal, 40, 24);
  assert.notEqual(modal.wrapped, original);
  const resized = modal.wrapped;
  modal.lines.push("new line");
  terminalFrame([], modal, 40, 24);
  assert.notEqual(modal.wrapped, resized);
});
