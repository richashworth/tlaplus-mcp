/**
 * Parse TLC CFG files for invariant and property declarations.
 *
 * Ported from Python: tlaplus-workflow/scripts/dot-to-json.py (parse_cfg)
 */

export interface CfgResult {
  invariants: string[];
  properties: string[];
}

/**
 * Parse a TLC CFG file's content for INVARIANT(S) and PROPERT(Y|IES) declarations.
 *
 * Handles both single-line (INVARIANT Foo) and multi-line formats:
 *   INVARIANTS
 *     Foo
 *     Bar
 */
export function parseCfg(content: string): CfgResult {
  const invariants: string[] = [];
  const properties: string[] = [];
  let currentList: string[] | null = null;

  const lines = content.split("\n");

  for (const line of lines) {
    const stripped = line.trim();

    if (!stripped || stripped.startsWith("\\*")) {
      currentList = null;
      continue;
    }

    // Single-line: INVARIANT Foo or INVARIANTS Foo Bar
    const invMatch = stripped.match(/^INVARIANTS?\s+(.*)/);
    if (invMatch) {
      const names = invMatch[1].split(/\s+/).filter(Boolean);
      if (names.length > 0) {
        invariants.push(...names);
        currentList = null;
      } else {
        currentList = invariants;
      }
      continue;
    }

    // Single-line: PROPERTY Foo or PROPERTIES Foo Bar
    const propMatch = stripped.match(/^PROPERT(?:Y|IES)\s+(.*)/);
    if (propMatch) {
      const names = propMatch[1].split(/\s+/).filter(Boolean);
      if (names.length > 0) {
        properties.push(...names);
        currentList = null;
      } else {
        currentList = properties;
      }
      continue;
    }

    // Bare keyword with no trailing text
    if (stripped === "INVARIANT" || stripped === "INVARIANTS") {
      currentList = invariants;
      continue;
    }
    if (stripped === "PROPERTY" || stripped === "PROPERTIES") {
      currentList = properties;
      continue;
    }

    // Indented continuation line
    if (currentList !== null && (line[0] === " " || line[0] === "\t")) {
      currentList.push(...stripped.split(/\s+/).filter(Boolean));
      continue;
    }

    // Any other keyword resets multi-line accumulation
    currentList = null;
  }

  return { invariants, properties };
}
