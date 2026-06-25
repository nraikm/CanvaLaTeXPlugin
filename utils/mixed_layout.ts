/**
 * Helpers for the "Text + math" mode, where the user types prose with inline
 * LaTeX delimited by `$...$` (e.g. `certainly $x^2 + 2ac$ is appropriate`) and
 * lightweight markdown for styling: `**bold**`, `*italic*`, and `__underline__`.
 *
 * Two outputs are produced from the same source string:
 *  - {@link renderMixedPreview} builds a single multi-line SVG for the in-panel
 *    preview thumbnail.
 *  - {@link buildMixedElements} builds canvas content for insertion — either
 *    one LaTeX SVG per line (`native`) or native Canva text with inline math
 *    images (`canva`).
 */
import type { FontRef, FontWeight, GroupContentAtPoint } from "@canva/design";
import { type RenderResult, renderLatex } from "./latex_renderer";

/** A run of plain text with markdown styling applied. */
export type TextRun = {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
};

export type LineSegment =
  | { type: "text"; runs: TextRun[] }
  | { type: "math"; value: string };

/** How mixed-mode content is inserted onto the canvas. */
export type MixedRenderMode = "native" | "canva";

export type MixedData = {
  source: string;
  color: string;
  fontSize: number;
  fontRef?: string;
  /**
   * - `native`: one LaTeX SVG image per line (matches the in-panel preview).
   * - `canva`: native Canva text elements with inline math images.
   */
  mixedRender?: MixedRenderMode;
};

/** The maximum font size Canva allows on a native text element. */
export const MAX_TEXT_FONT_SIZE = 100;

/** Gap before inline math when preceding prose has no trailing whitespace. */
const MATH_BEFORE_GAP = 3;

/** Gap after inline math when following prose has no leading whitespace. */
const MATH_AFTER_GAP = 0;

/** Small buffer added after each measured text run in Canva-text mode. */
const TEXT_ADVANCE_BUFFER = 2;

/** Width multiplier for default Canva sans-serif vs canvas `measureText`. */
const SANS_WIDTH_SCALE = 1.06;

/** Width multiplier when a Canva font is selected (metrics differ from sans-serif). */
const FONTREF_WIDTH_SCALE = 1.13;

/** Extra advance buffer when a Canva font is selected. */
const FONTREF_TEXT_ADVANCE_BUFFER = 2;

/** Unconditional padding around inline math in default Canva sans-serif mode. */
const SANS_MATH_PADDING = 2;

/** Unconditional padding around inline math when a custom Canva font is selected. */
const FONTREF_MATH_PADDING = 4;

/** Canva rejects image alt text longer than 250 characters. */
export const MAX_ALT_TEXT_LENGTH = 250;

/**
 * Distance from a Canva text element's `top` to its alphabetic baseline, as a
 * fraction of `fontSize`. This is the glyph baseline inside the text box, not
 * the line-height baseline. Using line-height here drops inline math below
 * surrounding normal text.
 */
const SANS_TEXT_BASELINE_RATIO = 0.95;
const FONTREF_TEXT_BASELINE_RATIO = 1;

/** Lowers inline math relative to surrounding `\text{}` in native LaTeX lines. */
const NATIVE_MATH_LOWER = "0.08em";

export function truncateAltText(value: string): string {
  return value.length <= MAX_ALT_TEXT_LENGTH
    ? value
    : value.slice(0, MAX_ALT_TEXT_LENGTH);
}

/** Splits text into styled runs based on `**`, `*`, and `__` markdown markers. */
function parseInline(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let bold = false;
  let italic = false;
  let underline = false;
  let buffer = "";

  const flush = () => {
    if (buffer.length > 0) {
      runs.push({ text: buffer, bold, italic, underline });
      buffer = "";
    }
  };

  let i = 0;
  while (i < text.length) {
    const pair = text.slice(i, i + 2);
    if (pair === "**") {
      flush();
      bold = !bold;
      i += 2;
      continue;
    }
    if (pair === "__") {
      flush();
      underline = !underline;
      i += 2;
      continue;
    }
    if (text[i] === "*") {
      flush();
      italic = !italic;
      i += 1;
      continue;
    }
    buffer += text[i];
    i += 1;
  }
  flush();
  return runs;
}

/** Splits a single line into alternating text (styled runs) and math segments. */
function parseLine(line: string): LineSegment[] {
  const segments: LineSegment[] = [];
  const regex = /\$([^$]+)\$/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const pushText = (value: string) => {
    if (value.length === 0) {
      return;
    }
    const runs = parseInline(value);
    if (runs.length > 0) {
      segments.push({ type: "text", runs });
    }
  };

  while ((match = regex.exec(line)) != null) {
    if (match.index > lastIndex) {
      pushText(line.slice(lastIndex, match.index));
    }
    segments.push({ type: "math", value: match[1] ?? "" });
    lastIndex = regex.lastIndex;
  }
  pushText(line.slice(lastIndex));
  return segments;
}

/** Parses the full source into lines, each split into segments. */
export function parseMixed(source: string): LineSegment[][] {
  return source.split("\n").map(parseLine);
}

/** Whether the source contains at least one inline math segment. */
export function hasMath(source: string): boolean {
  return /\$([^$]+)\$/.test(source);
}

/** Escapes plain text so it can be safely embedded inside a LaTeX `\text{}`. */
function escapeTeXText(value: string): string {
  return value
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

/** Wraps an escaped text run in the LaTeX commands for its markdown styling. */
function runToTeX(run: TextRun): string {
  let piece = `\\text{${escapeTeXText(run.text)}}`;
  if (run.italic) {
    piece = `\\textit{${piece}}`;
  }
  if (run.bold) {
    piece = `\\textbf{${piece}}`;
  }
  if (run.underline) {
    piece = `\\underline{${piece}}`;
  }
  return piece;
}

/** Wraps a math fragment for native mode so it sits on the `\text{}` baseline. */
function mathToNativeLatex(value: string): string {
  return `\\lower${NATIVE_MATH_LOWER}{${value}}`;
}

/** Converts parsed line segments into a LaTeX expression for rendering. */
function segmentsToLatex(
  segments: LineSegment[],
  options?: { lowerMath?: boolean },
): string {
  const lowerMath = options?.lowerMath ?? false;
  const body = segments
    .map((segment) =>
      segment.type === "math"
        ? lowerMath
          ? mathToNativeLatex(segment.value)
          : segment.value
        : segment.runs.map(runToTeX).join(""),
    )
    .join("");
  return body.length > 0 ? body : "\\phantom{0}";
}

/**
 * Renders the whole mixed string to a single multi-line SVG for the preview.
 * Throws {@link LatexError} if any math segment is invalid.
 */
export function renderMixedPreview(data: MixedData): RenderResult {
  const lines = parseMixed(data.source).map((segments) =>
    segmentsToLatex(segments),
  );

  const combined =
    lines.length > 1
      ? `\\begin{array}{l}${lines.join("\\\\")}\\end{array}`
      : lines[0] ?? "\\phantom{0}";

  return renderLatex(combined, {
    displayMode: true,
    color: data.color,
    fontSize: data.fontSize,
  });
}

let measureContext: CanvasRenderingContext2D | null | undefined;

/** Lazily creates a canvas 2D context used to estimate text widths. */
function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureContext === undefined) {
    measureContext = document.createElement("canvas").getContext("2d");
  }
  return measureContext;
}

/**
 * Inserts mixed content as one LaTeX SVG image per line. Spacing matches the
 * in-panel preview because text and math share the same math font.
 */
function buildNativeMixedElements(data: MixedData): GroupContentAtPoint[] {
  const lines = parseMixed(data.source);
  const fontSize = Math.max(1, Math.round(data.fontSize));
  const children: GroupContentAtPoint[] = [];
  let y = 0;
  const lineGap = Math.round(fontSize * 0.2);

  for (const segments of lines) {
    const { dataUrl, width, height } = renderLatex(
      segmentsToLatex(segments, { lowerMath: true }),
      {
        displayMode: false,
        color: data.color,
        fontSize,
      },
    );
    children.push({
      type: "image",
      dataUrl,
      width,
      height,
      top: y,
      left: 0,
      altText: { text: truncateAltText(data.source), decorative: false },
    });
    y += height + lineGap;
  }

  return children;
}

/**
 * Measures how far to advance the layout cursor past a text run in Canva-text
 * mode. Canvas `measureText` uses generic sans-serif, so a small buffer (and
 * optional scale when a Canva font is selected) reduces overlap with adjacent
 * math. Text elements omit `width` so Canva auto-sizes each run to a single
 * line and never wraps inside the box.
 */
function measureTextAdvance(
  ctx: CanvasRenderingContext2D | null,
  run: TextRun,
  fontSize: number,
  hasFontRef: boolean,
): number {
  let width: number;
  if (ctx) {
    ctx.font = `${run.italic ? "italic " : ""}${
      run.bold ? "700" : "400"
    } ${fontSize}px sans-serif`;
    width = ctx.measureText(run.text).width;
  } else {
    width = run.text.length * fontSize * 0.5;
  }
  const scale = hasFontRef ? FONTREF_WIDTH_SCALE : SANS_WIDTH_SCALE;
  const buffer =
    TEXT_ADVANCE_BUFFER + (hasFontRef ? FONTREF_TEXT_ADVANCE_BUFFER : 0);
  return Math.max(1, Math.ceil(width * scale) + buffer);
}

/** Merges adjacent runs that share the same markdown styling. */
function mergeAdjacentRuns(runs: TextRun[]): TextRun[] {
  const merged: TextRun[] = [];
  for (const run of runs) {
    if (run.text.length === 0) {
      continue;
    }
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.bold === run.bold &&
      prev.italic === run.italic &&
      prev.underline === run.underline
    ) {
      prev.text += run.text;
    } else {
      merged.push({
        text: run.text,
        bold: run.bold,
        italic: run.italic,
        underline: run.underline,
      });
    }
  }
  return merged;
}

/** Distance from `top` to the alphabetic baseline for a Canva text element. */
function canvaTextBaselineFromTop(
  fontSize: number,
  hasFontRef: boolean,
): number {
  const ratio = hasFontRef
    ? FONTREF_TEXT_BASELINE_RATIO
    : SANS_TEXT_BASELINE_RATIO;
  return Math.round(fontSize * ratio);
}

/** Last non-empty text in a text segment, if any. */
function lastTextRun(segment: LineSegment): TextRun | undefined {
  if (segment.type !== "text") {
    return undefined;
  }
  for (let i = segment.runs.length - 1; i >= 0; i -= 1) {
    const run = segment.runs[i];
    if (run && run.text.length > 0) {
      return run;
    }
  }
  return undefined;
}

/** First non-empty text in a text segment, if any. */
function firstTextRun(segment: LineSegment): TextRun | undefined {
  if (segment.type !== "text") {
    return undefined;
  }
  for (const run of segment.runs) {
    if (run.text.length > 0) {
      return run;
    }
  }
  return undefined;
}

/**
 * Builds the group of child elements (native text + inline math images) for an
 * inserted "Text + math" app element in Canva-text mode.
 *
 * Canva positions group children absolutely, so we lay each line out left to
 * right starting at x = 0 and stack lines vertically. Inline math SVGs align
 * their baseline to Canva text: `top = yBase + textBaselineFromTop -
 * baselineFromTop`.
 */
function buildCanvaMixedElements(data: MixedData): GroupContentAtPoint[] {
  const lines = parseMixed(data.source);
  const fontSize = Math.min(
    MAX_TEXT_FONT_SIZE,
    Math.max(1, Math.round(data.fontSize)),
  );
  const lineHeight = Math.round(fontSize * 1.5);
  const textBaselineFromTop = canvaTextBaselineFromTop(
    fontSize,
    data.fontRef != null,
  );
  const fontRef = data.fontRef as FontRef | undefined;
  const hasFontRef = fontRef != null;

  const ctx = getMeasureContext();
  const children: GroupContentAtPoint[] = [];

  lines.forEach((segments, lineIndex) => {
    const yBase = lineIndex * lineHeight;
    let x = 0;

    segments.forEach((segment, segmentIndex) => {
      const prev = segments[segmentIndex - 1];
      const next = segments[segmentIndex + 1];

      if (segment.type === "text") {
        for (const run of mergeAdjacentRuns(segment.runs)) {
          const advance = measureTextAdvance(ctx, run, fontSize, hasFontRef);
          children.push({
            type: "text",
            children: [run.text],
            fontSize,
            color: data.color,
            fontRef,
            fontWeight: (run.bold ? "bold" : "normal") as FontWeight,
            fontStyle: run.italic ? "italic" : "normal",
            decoration: run.underline ? "underline" : "none",
            textAlign: "start",
            top: yBase,
            left: x,
          });
          x += advance;
        }
      } else {
        const mathPadding = hasFontRef
          ? FONTREF_MATH_PADDING
          : SANS_MATH_PADDING;
        x += mathPadding;

        const prevText = prev ? lastTextRun(prev) : undefined;
        if (prevText && !/\s$/.test(prevText.text)) {
          x += MATH_BEFORE_GAP;
        }

        const { dataUrl, width, height, baselineFromTop } = renderLatex(
          segment.value,
          {
            displayMode: false,
            color: data.color,
            fontSize,
          },
        );
        children.push({
          type: "image",
          dataUrl,
          width,
          height,
          top: Math.round(yBase + textBaselineFromTop - baselineFromTop),
          left: x,
          altText: { text: truncateAltText(segment.value), decorative: false },
        });
        x += width;
        x += mathPadding;

        const nextText = next ? firstTextRun(next) : undefined;
        if (nextText && !/^\s/.test(nextText.text)) {
          x += MATH_AFTER_GAP;
        }
      }
    });
  });

  return children;
}

/**
 * Builds the group of child elements for an inserted "Text + math" app
 * element. {@link MixedData.mixedRender} selects native LaTeX images vs
 * editable Canva text with inline math.
 */
export function buildMixedElements(data: MixedData): GroupContentAtPoint[] {
  const mode = data.mixedRender ?? "native";
  return mode === "native"
    ? buildNativeMixedElements(data)
    : buildCanvaMixedElements(data);
}
