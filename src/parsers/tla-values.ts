/**
 * Recursive-descent parser for TLA+ values as printed by TLC.
 *
 * Ported from Python: tlaplus-workflow/scripts/dot-to-json.py (_ValueParser)
 */

import type { TlaValue, VarMap } from "./types.js";

class ValueParser {
  private text: string;
  private pos: number;

  constructor(text: string) {
    this.text = text;
    this.pos = 0;
  }

  // -- helpers ---------------------------------------------------------------

  private skipWs(): void {
    while (this.pos < this.text.length && " \t\n\r".includes(this.text[this.pos])) {
      this.pos++;
    }
  }

  private peek(): string | null {
    this.skipWs();
    if (this.pos >= this.text.length) return null;
    return this.text[this.pos];
  }

  private match(s: string): boolean {
    this.skipWs();
    if (this.text.slice(this.pos, this.pos + s.length) === s) {
      this.pos += s.length;
      return true;
    }
    return false;
  }

  private expect(s: string): void {
    if (!this.match(s)) {
      throw new Error(
        `Expected ${JSON.stringify(s)} at pos ${this.pos}: ...${JSON.stringify(this.text.slice(this.pos, this.pos + 20))}...`
      );
    }
  }

  // -- grammar ---------------------------------------------------------------

  parse(): TlaValue {
    return this.parseValue();
  }

  private parseValue(): TlaValue {
    this.skipWs();
    if (this.pos >= this.text.length) {
      throw new Error("Unexpected end of input");
    }

    const c = this.text[this.pos];

    // String literal (possibly escaped quotes from DOT)
    if (
      c === '"' ||
      (c === '\\' && this.pos + 1 < this.text.length && this.text[this.pos + 1] === '"')
    ) {
      return this.parseString();
    }

    // Sequence <<...>>
    if (c === '<' && this.pos + 1 < this.text.length && this.text[this.pos + 1] === '<') {
      return this.parseSequence();
    }

    // Set {...}
    if (c === '{') {
      return this.parseSet();
    }

    // Record [field |-> ...]
    if (c === '[') {
      return this.parseRecord();
    }

    // Parenthesized function display (k :> v @@ ...)
    if (c === '(') {
      return this.parseFunction();
    }

    // Boolean
    if (this.text.slice(this.pos, this.pos + 4) === "TRUE") {
      this.pos += 4;
      return true;
    }
    if (this.text.slice(this.pos, this.pos + 5) === "FALSE") {
      this.pos += 5;
      return false;
    }

    // Number (possibly negative)
    if (c === '-' || (c >= '0' && c <= '9')) {
      return this.parseNumber();
    }

    // Bare identifier (model value)
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_') {
      return this.parseIdentifier();
    }

    throw new Error(
      `Unexpected char ${JSON.stringify(c)} at pos ${this.pos}: ...${JSON.stringify(this.text.slice(this.pos, this.pos + 20))}...`
    );
  }

  private parseString(): string {
    if (
      this.text[this.pos] === '\\' &&
      this.pos + 1 < this.text.length &&
      this.text[this.pos + 1] === '"'
    ) {
      this.pos += 2; // skip \"
      return this.readStringBody(true);
    } else {
      this.pos += 1; // skip "
      return this.readStringBody(false);
    }
  }

  private readStringBody(escapedQuote: boolean): string {
    const chars: string[] = [];
    while (this.pos < this.text.length) {
      if (escapedQuote) {
        if (
          this.text[this.pos] === '\\' &&
          this.pos + 1 < this.text.length &&
          this.text[this.pos + 1] === '"'
        ) {
          this.pos += 2;
          return chars.join("");
        }
      } else {
        if (this.text[this.pos] === '"') {
          this.pos += 1;
          return chars.join("");
        }
      }
      if (this.text[this.pos] === '\\' && !escapedQuote) {
        this.pos += 1;
        if (this.pos < this.text.length) {
          chars.push(this.text[this.pos]);
          this.pos += 1;
        }
        continue;
      }
      chars.push(this.text[this.pos]);
      this.pos += 1;
    }
    throw new Error("Unterminated string");
  }

  private parseNumber(): number {
    const start = this.pos;
    if (this.text[this.pos] === '-') {
      this.pos++;
    }
    while (this.pos < this.text.length && this.text[this.pos] >= '0' && this.text[this.pos] <= '9') {
      this.pos++;
    }
    return parseInt(this.text.slice(start, this.pos), 10);
  }

  private parseIdentifier(): string {
    const start = this.pos;
    while (
      this.pos < this.text.length &&
      ((this.text[this.pos] >= 'a' && this.text[this.pos] <= 'z') ||
        (this.text[this.pos] >= 'A' && this.text[this.pos] <= 'Z') ||
        (this.text[this.pos] >= '0' && this.text[this.pos] <= '9') ||
        this.text[this.pos] === '_')
    ) {
      this.pos++;
    }
    return this.text.slice(start, this.pos);
  }

  private parseSequence(): TlaValue[] {
    this.expect("<<");
    this.skipWs();
    if (this.match(">>")) return [];
    const items: TlaValue[] = [this.parseValue()];
    while (this.match(",")) {
      items.push(this.parseValue());
    }
    this.expect(">>");
    return items;
  }

  private parseSet(): TlaValue[] {
    this.expect("{");
    this.skipWs();
    if (this.match("}")) return [];
    const items: TlaValue[] = [this.parseValue()];
    while (this.match(",")) {
      items.push(this.parseValue());
    }
    this.expect("}");
    return items;
  }

  private parseRecord(): Record<string, TlaValue> {
    this.expect("[");
    this.skipWs();
    if (this.match("]")) return {};
    const entries: [string, TlaValue][] = [];
    while (true) {
      this.skipWs();
      const key = this.parseIdentifier();
      this.expect("|->");
      const val = this.parseValue();
      entries.push([key, val]);
      if (!this.match(",")) break;
    }
    this.expect("]");
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    return Object.fromEntries(entries);
  }

  private parseFunction(): Record<string, TlaValue> {
    this.expect("(");
    const entries: [string, TlaValue][] = [];
    while (true) {
      this.skipWs();
      const key = this.parseValue();
      this.expect(":>");
      const val = this.parseValue();
      entries.push([jsonKey(key), val]);
      this.skipWs();
      if (!this.match("@@")) break;
    }
    this.expect(")");
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    return Object.fromEntries(entries);
  }
}

function jsonKey(v: TlaValue): string {
  if (typeof v === "string") return v;
  return String(v);
}

/**
 * Parse a single TLA+ value string into a JSON-compatible object.
 */
export function parseTlaValue(text: string): TlaValue {
  const p = new ValueParser(text.trim());
  return p.parse();
}

/**
 * Parse a TLC state label (conjunction of /\ var = value) into a variable map.
 */
export function parseStateLabel(label: string): VarMap {
  const variables: VarMap = {};
  const parts = label.split(/\/\\/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]*)/);
    if (m) {
      const varName = m[1];
      const rawValue = m[2].trim();
      try {
        variables[varName] = parseTlaValue(rawValue);
      } catch {
        variables[varName] = rawValue; // fallback: keep raw string
      }
    }
  }
  const sorted: VarMap = {};
  for (const key of Object.keys(variables).sort()) {
    sorted[key] = variables[key];
  }
  return sorted;
}
