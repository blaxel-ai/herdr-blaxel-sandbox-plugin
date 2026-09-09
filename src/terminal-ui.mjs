import readline from "node:readline";
import { stripVTControlCharacters } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import stringWidth from "string-width";

export const isMain = (url) =>
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(url);
export const plainText = (value) =>
  stripVTControlCharacters(String(value))
    .replace(/\r/g, "")
    // eslint-disable-next-line no-control-regex -- strip untrusted terminal controls
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\t/g, "    ");
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
function cells(text) {
  return Array.from(
    segmenter.segment(plainText(text)),
    ({ segment }) => segment,
  );
}
export function fit(text, width, start = 0) {
  let column = 0,
    result = "",
    used = 0;
  for (const character of cells(text)) {
    const size = stringWidth(character);
    if (column >= start && column + size <= start + width) {
      result += character;
      used += size;
    } else if (column < start && column + size > start) {
      result += " ";
      used++;
    }
    column += size;
    if (column >= start + width) break;
  }
  return result + " ".repeat(Math.max(0, width - used));
}
function wrap(lines, width) {
  return lines.flatMap((line) => {
    const result = [];
    let row = "",
      used = 0;
    for (const character of cells(line)) {
      const size = stringWidth(character);
      if (used + size > width) {
        const space = row.lastIndexOf(" ");
        result.push(space > 0 ? row.slice(0, space) : row);
        row = space > 0 ? row.slice(space + 1) : "";
        used = stringWidth(row);
      }
      row += character;
      used += size;
    }
    result.push(row);
    return result;
  });
}

export function terminalFrame(background, modal, width, height) {
  width = Math.max(1, width);
  height = Math.max(1, height);
  if (width < 40 || height < 12)
    return Array.from({ length: height }, (_, i) =>
      fit(
        ["Terminal too small", "Resize to 40 x 12", "Esc cancels"][i] ?? "",
        width,
      ),
    ).join("\n");
  const rows = Array.from({ length: height }, (_, i) =>
    fit(background[i] ?? "", width),
  );
  if (!modal) return rows.join("\n");
  const boxWidth = Math.min(104, width - 4),
    bodyWidth = boxWidth - 4;
  if (
    modal.wrapped?.width !== bodyWidth ||
    modal.wrapped?.count !== modal.lines.length
  )
    modal.wrapped = {
      width: bodyWidth,
      count: modal.lines.length,
      lines: wrap(modal.lines, bodyWidth),
    };
  const lines = modal.wrapped.lines;
  const boxHeight = Math.min(height - 2, 30, Math.max(10, lines.length + 6)),
    visible = Math.max(1, boxHeight - 6);
  modal.boxHeight = boxHeight;
  modal.maxOffset = Math.max(0, lines.length - visible);
  modal.pageSize = visible;
  const offset = Math.min(Math.max(0, modal.offset), modal.maxOffset);
  const left = Math.floor((width - boxWidth) / 2),
    top = Math.floor((height - boxHeight) / 2);
  const edge = (text) => `\u001b[36m${text}\u001b[0m`;
  const row = (text) => `${edge("│")} ${text} ${edge("│")}`;
  const box = [
    edge(`╭${"─".repeat(boxWidth - 2)}╮`),
    row(`\u001b[1m${fit(modal.title, bodyWidth)}\u001b[0m`),
    row(edge("─".repeat(bodyWidth))),
  ];
  for (let i = 0; i < visible; i++) {
    const line = lines[offset + i] ?? "";
    const color = !modal.review
      ? null
      : /^(diff --git|@@|\+\+\+|---)/.test(line)
        ? 36
        : line.startsWith("+")
          ? 32
          : line.startsWith("-")
            ? 31
            : null;
    const content = fit(line, bodyWidth);
    box.push(row(color ? `\u001b[${color}m${content}\u001b[0m` : content));
  }
  const hint =
    lines.length > visible
      ? `PgUp/PgDn  ${offset + 1}-${Math.min(lines.length, offset + visible)}/${lines.length}`
      : "";
  const prompt = modal.prompt ? `${modal.prompt} ${modal.value}` : "Working...";
  box.push(
    row(`\u001b[2m${fit(hint, bodyWidth)}\u001b[0m`),
    row(
      fit(prompt, bodyWidth, Math.max(0, stringWidth(prompt) - bodyWidth + 1)),
    ),
    edge(`╰${"─".repeat(boxWidth - 2)}╯`),
  );
  return rows
    .map((row, i) => {
      const overlay = box[i - top];
      if (!overlay) return `\u001b[2m${row}\u001b[0m`;
      return `\u001b[2m${fit(row, left)}\u001b[0m${overlay}\u001b[2m${fit(row, width - left - boxWidth, left + boxWidth)}\u001b[0m`;
    })
    .join("\n");
}

export class TerminalUI {
  constructor({
    input = process.stdin,
    output = process.stdout,
    onKey = () => {},
  } = {}) {
    Object.assign(this, {
      input,
      output,
      onKey,
      background: [],
      dialog: null,
      lastFrame: null,
    });
    this.handleKey = this.handleKey.bind(this);
    this.render = this.render.bind(this);
  }
  start() {
    if (!this.input.isTTY || !this.output.isTTY)
      throw new Error("This interface requires an interactive terminal.");
    this.started = true;
    this.wasRaw = this.input.isRaw;
    readline.emitKeypressEvents(this.input);
    this.input.setRawMode(true);
    this.input.on("keypress", this.handleKey);
    this.output.on("resize", this.render);
    this.output.write("\u001b[?1049h\u001b[?25l\u001b[?7l");
    this.render();
  }
  setBackground(lines) {
    this.background = lines;
    this.render();
  }
  render() {
    if (this.closed) return;
    const frame = terminalFrame(
      this.background,
      this.dialog,
      this.output.columns ?? 100,
      this.output.rows ?? 30,
    );
    if (frame !== this.lastFrame) {
      this.output.write(
        `\u001b[H${frame.split("\n").join("\u001b[0K\r\n")}\u001b[0K`,
      );
      this.lastFrame = frame;
    }
    const width = this.output.columns ?? 100;
    const height = this.output.rows ?? 30;
    if (this.dialog?.resolve && width >= 40 && height >= 12) {
      const boxWidth = Math.min(104, width - 4);
      const boxHeight = this.dialog.boxHeight;
      const left = Math.floor((width - boxWidth) / 2);
      const row = Math.floor((height - boxHeight) / 2) + boxHeight - 1;
      const column = Math.min(
        left + boxWidth - 2,
        left + 3 + stringWidth(`${this.dialog.prompt} ${this.dialog.value}`),
      );
      this.output.write(`\u001b[${row};${column}H\u001b[?25h`);
    } else this.output.write("\u001b[?25l");
  }
  handleKey(text, key = {}) {
    const dialog = this.dialog;
    if (!dialog) {
      this.onKey(text, key);
      return;
    }
    if (
      ((this.output.columns ?? 100) < 40 || (this.output.rows ?? 30) < 12) &&
      key.name !== "escape" &&
      !(key.ctrl && key.name === "c")
    )
      return;
    if (["pageup", "pagedown", "up", "down"].includes(key.name)) {
      const direction = ["pageup", "up"].includes(key.name) ? -1 : 1;
      dialog.offset = Math.max(
        0,
        Math.min(
          dialog.maxOffset ?? 0,
          dialog.offset +
            direction * (key.name.startsWith("page") ? dialog.pageSize : 1),
        ),
      );
    } else if (dialog.resolve) {
      if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        const resolve = dialog.resolve;
        dialog.resolve = null;
        resolve("");
      } else if (["return", "enter"].includes(key.name)) {
        const resolve = dialog.resolve;
        dialog.resolve = null;
        resolve(dialog.value);
      } else if (key.name === "backspace")
        dialog.value = cells(dialog.value).slice(0, -1).join("");
      else if (!key.ctrl && !key.meta && text)
        dialog.value = (dialog.value + plainText(text)).slice(0, 200);
    }
    this.render();
  }
  async modal(title, task) {
    if (this.dialog) return;
    const dialog = {
      title,
      lines: [],
      value: "",
      offset: 0,
      prompt: null,
      resolve: null,
    };
    this.dialog = dialog;
    const ui = {
      write: (value) => {
        dialog.lines.push(...plainText(value).split("\n"));
        this.render();
      },
      ask: (question, { timeoutMs, review = false } = {}) => {
        dialog.prompt = question;
        dialog.review = review;
        dialog.value = "";
        dialog.offset = review ? 0 : (dialog.maxOffset ?? 0);
        return new Promise((resolve) => {
          const timer = timeoutMs
            ? setTimeout(() => {
                dialog.resolve = null;
                resolve("");
              }, timeoutMs)
            : null;
          dialog.resolve = (answer) => {
            clearTimeout(timer);
            dialog.prompt = null;
            resolve(answer);
          };
          this.render();
        });
      },
    };
    this.render();
    try {
      await task(ui);
      return true;
    } catch (error) {
      ui.write(`\n${error instanceof Error ? error.message : String(error)}`);
      await ui.ask("Enter or Esc to close");
      return false;
    } finally {
      this.dialog = null;
      this.render();
    }
  }
  close() {
    if (!this.started) return;
    this.closed = true;
    this.input.off("keypress", this.handleKey);
    this.output.off("resize", this.render);
    this.input.setRawMode(this.wasRaw ?? false);
    this.input.pause();
    this.output.write("\u001b[0m\u001b[?7h\u001b[?25h\u001b[?1049l");
  }
}

export async function runPane(title, task) {
  const terminal = new TerminalUI();
  try {
    terminal.start();
    if (!(await terminal.modal(title, task))) process.exitCode = 1;
  } finally {
    terminal.close();
  }
}
