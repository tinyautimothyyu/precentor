// Structured lyrics helpers — mirrors backend catalog/flows.py.
import type { FlowStep, Section } from "@/lib/types";

/** Code -> [type, label]. Verses are numbered (V1, V2); others bare first (C, then C2). */
export const SECTION_CODES: Record<string, [string, string]> = {
  V: ["verse", "Verse"],
  PC: ["prechorus", "Pre-chorus"],
  C: ["chorus", "Chorus"],
  B: ["bridge", "Bridge"],
  ET: ["tag", "End tag"],
  I: ["intro", "Intro"],
  O: ["outro", "Outro"],
};
export const MARKERS: Record<string, string> = {
  MB: "Music break",
  INST: "Instrumental",
  BRK: "Break",
};

const SECTION_ID = /^(V|PC|C|B|ET|I|O)([1-9]\d?)?$/;

/** "v" -> "V1", "c1" -> "C", "C2" -> "C2"; null if not a section id. */
export function canonicalId(raw: string): string | null {
  const m = raw.trim().toUpperCase().match(SECTION_ID);
  if (!m) return null;
  const [, code, num] = m;
  if (code === "V") return `V${num ?? 1}`;
  return !num || num === "1" ? code : `${code}${num}`;
}

function splitId(id: string): [string, string | undefined] {
  const m = id.match(SECTION_ID)!;
  return [m[1], m[2]];
}

export function sectionLabel(id: string): string {
  const [code, num] = splitId(id);
  const base = SECTION_CODES[code][1];
  return code === "V" || num ? `${base} ${num ?? 1}` : base;
}

export function sectionType(id: string): string {
  return SECTION_CODES[splitId(id)[0]][0];
}

export function makeSection(id: string, lines: string[] = []): Section {
  return { id, type: sectionType(id), label: sectionLabel(id), lines };
}

/** Next unused id for a code: V -> V3 if V1, V2 exist; C -> C2 if C exists. */
export function nextFreeId(code: string, taken: Set<string>): string {
  for (let n = 1; n < 100; n++) {
    const id = canonicalId(`${code}${n}`)!;
    if (!taken.has(id)) return id;
  }
  return `${code}99`;
}

// --- shorthand: "V C V C MB C ET" ----------------------------------------

export interface ParsedFlow {
  steps: FlowStep[];
  /** Tokens that aren't a section, marker or remix reference. */
  invalid: string[];
  /** Section ids used but not written for this song (yet). */
  missing: string[];
}

/**
 * Bare "V" auto-numbers (first V -> V1, next -> V2; "V3" resets the count);
 * other bare codes always mean the same section (every "C" is the chorus).
 * "@12:C" borrows section C of song 12 (remix).
 */
export function parseShorthand(text: string, known: Set<string>): ParsedFlow {
  const steps: FlowStep[] = [];
  const invalid: string[] = [];
  const missing = new Set<string>();
  let verse = 0;
  for (const raw of text.split(/[\s,]+/).filter(Boolean)) {
    const tok = raw.toUpperCase();
    const remix = tok.match(/^@(\d+):(.+)$/);
    if (remix) {
      const id = canonicalId(remix[2]);
      if (id) steps.push({ song: Number(remix[1]), section: id });
      else invalid.push(raw);
      continue;
    }
    if (tok in MARKERS) {
      steps.push({ marker: tok, label: MARKERS[tok] });
      continue;
    }
    const m = tok.match(/^(V|PC|C|B|ET|I|O)(\d*)$/);
    const id = m
      ? m[1] === "V"
        ? `V${m[2] ? (verse = Number(m[2])) : ++verse}`
        : canonicalId(tok)
      : null;
    if (!id || !SECTION_ID.test(id)) {
      invalid.push(raw);
      continue;
    }
    steps.push({ section: id });
    if (!known.has(id)) missing.add(id);
  }
  return { steps, invalid, missing: [...missing] };
}

export function stepsToShorthand(steps: FlowStep[]): string {
  return steps
    .map((s) =>
      "marker" in s ? s.marker : s.song != null ? `@${s.song}:${s.section}` : s.section
    )
    .join(" ");
}

// --- paste-to-split -------------------------------------------------------

const ZH_NUM: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};
const EN_HEADING =
  /^[\[(]?\s*(verse|chorus|refrain|pre-?\s?chorus|bridge|end(?:ing)?\s*tag|tag|ending|intro|outro)\s*(\d+)?\s*[\])]?\s*:?\s*$/i;
// Uppercase only, so one-word lyric lines ("b", "c") aren't taken for headings.
const SHORT_HEADING = /^[\[(]?(V|PC|C|B|ET)(\d*)[\])]?[:.]?$/;
const ZH_HEADING =
  /^[\[(【]?\s*(主歌|副歌|導歌|导歌|前副歌|橋段|桥段|尾聲|尾声|結尾|结尾|前奏|尾奏)\s*([一二三四五六七八九十]|\d+)?\s*[\])】]?\s*[:：]?\s*$/;
const EN_CODE: Record<string, string> = {
  verse: "V", chorus: "C", refrain: "C", prechorus: "PC", bridge: "B",
  tag: "ET", endtag: "ET", endingtag: "ET", ending: "ET", intro: "I", outro: "O",
};
const ZH_CODE: Record<string, string> = {
  主歌: "V", 副歌: "C", 導歌: "PC", 导歌: "PC", 前副歌: "PC", 橋段: "B", 桥段: "B",
  尾聲: "ET", 尾声: "ET", 結尾: "ET", 结尾: "ET", 前奏: "I", 尾奏: "O",
};

/** A heading line -> [code, number?], or null for a lyric line. */
export function parseHeading(line: string): [string, number | undefined] | null {
  const t = line.trim();
  let m = t.match(EN_HEADING);
  if (m) {
    const key = m[1].toLowerCase().replace(/[\s-]/g, "");
    return [EN_CODE[key], m[2] ? Number(m[2]) : undefined];
  }
  m = t.match(ZH_HEADING);
  if (m) {
    const n = m[2] ? ZH_NUM[m[2]] ?? Number(m[2]) : undefined;
    return [ZH_CODE[m[1]], n];
  }
  m = t.match(SHORT_HEADING);
  if (m) return [m[1], m[2] ? Number(m[2]) : undefined];
  return null;
}

export interface SplitResult {
  sections: Section[];
  /** The pasted running order, e.g. V1 C V2 C. */
  steps: FlowStep[];
}

/**
 * Splits pasted lyrics into sections (each written once) and the pasted order.
 * Blocks start at a heading ("Verse 1", "Chorus", "[Bridge]", "副歌") or after
 * a blank line. A repeated block, or a heading with no lines, is a repeat of
 * the earlier section; an unlabeled block that occurs more than once is
 * suggested as the chorus.
 */
export function splitPastedLyrics(text: string): SplitResult {
  type Block = { code?: string; num?: number; lines: string[] };
  const blocks: Block[] = [];
  let cur: Block | null = null;
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const heading = parseHeading(line);
    if (heading) {
      cur = { code: heading[0], num: heading[1], lines: [] };
      blocks.push(cur);
    } else if (!line.trim()) {
      if (cur && cur.lines.length) cur = null; // blank line ends a block
    } else {
      if (!cur) {
        cur = { lines: [] };
        blocks.push(cur);
      }
      cur.lines.push(line.trim());
    }
  }

  const key = (lines: string[]) => lines.join("\n").toLowerCase();
  const counts = new Map<string, number>();
  for (const b of blocks) if (b.lines.length) counts.set(key(b.lines), (counts.get(key(b.lines)) ?? 0) + 1);

  const sections: Section[] = [];
  const byText = new Map<string, string>(); // text -> id
  const taken = new Set<string>();
  const steps: FlowStep[] = [];

  for (const b of blocks) {
    const k = key(b.lines);
    if (b.lines.length && byText.has(k)) {
      steps.push({ section: byText.get(k)! }); // repeated block
      continue;
    }
    let id: string;
    if (b.code) {
      // A bare "Verse" with new text takes the next free verse number.
      id =
        b.code === "V" && b.num === undefined
          ? nextFreeId("V", taken)
          : canonicalId(`${b.code}${b.num ?? ""}`)!;
      if (!b.lines.length) {
        steps.push({ section: id }); // heading only: repeat of that section
        continue;
      }
      if (taken.has(id)) id = nextFreeId(b.code, taken); // same label, new text
    } else {
      id = (counts.get(k) ?? 0) > 1 && !taken.has("C") ? "C" : nextFreeId("V", taken);
    }
    taken.add(id);
    byText.set(k, id);
    sections.push(makeSection(id, b.lines));
    steps.push({ section: id });
  }
  return { sections, steps };
}
