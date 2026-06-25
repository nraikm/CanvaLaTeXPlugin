/**
 * Converts LaTeX math into a self-contained SVG that can be inserted into a
 * Canva design as an image element.
 *
 * MathJax runs entirely in the browser via the lite DOM adaptor, so no network
 * requests or external fonts are required. Using `fontCache: "local"` inlines
 * all glyph paths into each SVG, which makes the output safe to embed directly
 * as a base64 data URL.
 */
import type { LiteElement } from "mathjax-full/js/adaptors/lite/Element.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { SVG } from "mathjax-full/js/output/svg.js";

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

// `formatError` is invoked when the TeX input contains a syntax error. By
// re-throwing we get a clean, catchable error with a human-readable message
// instead of MathJax rendering a red error block into the output.
const texInput = new TeX({
  packages: AllPackages,
  formatError: (_jax: unknown, error: { message: string }) => {
    throw error;
  },
});

const svgOutput = new SVG({ fontCache: "local" });

const mathDocument = mathjax.document("", {
  InputJax: texInput,
  OutputJax: svgOutput,
});

export type RenderOptions = {
  /** Render as a centered display equation (`true`) or inline math (`false`). */
  displayMode: boolean;
  /** The color of the rendered math, as a hex string (e.g. `#000000`). */
  color: string;
  /** The font size, in pixels, used to scale the output. */
  fontSize: number;
};

export type RenderResult = {
  /** The raw SVG markup, with explicit pixel dimensions and resolved color. */
  svg: string;
  /** A base64-encoded `image/svg+xml` data URL of the SVG. */
  dataUrl: string;
  /** The intrinsic width of the rendered math, in pixels. */
  width: number;
  /** The intrinsic height of the rendered math, in pixels. */
  height: number;
  /** Distance from the SVG top edge to the math baseline, in pixels. */
  baselineFromTop: number;
};

export class LatexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LatexError";
  }
}

function parseExValue(value: string | null): number {
  if (!value) {
    return 0;
  }
  const parsed = Number.parseFloat(value.replace("ex", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Reads MathJax's `vertical-align: -{depth}ex` style on the SVG root. */
function parseVerticalAlignDepthEx(style: string | null): number {
  const match = style?.match(/vertical-align:\s*(-?[\d.]+)ex/);
  if (!match) {
    return 0;
  }
  return Math.abs(Number.parseFloat(match[1] ?? "0"));
}

function svgToDataUrl(svg: string): string {
  // Encode as UTF-8 before base64 so non-ASCII glyphs survive `btoa`.
  const base64 = window.btoa(unescape(encodeURIComponent(svg)));
  return `data:image/svg+xml;base64,${base64}`;
}

/**
 * Renders the given LaTeX string to an SVG image.
 *
 * @throws {LatexError} If the LaTeX is empty or cannot be parsed.
 */
export function renderLatex(latex: string, options: RenderOptions): RenderResult {
  const trimmed = latex.trim();
  if (trimmed.length === 0) {
    throw new LatexError("Enter a LaTeX formula to get started.");
  }

  let container;
  try {
    container = mathDocument.convert(trimmed, { display: options.displayMode });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error && "message" in error
          ? String((error as { message: unknown }).message)
          : "That doesn't look like valid LaTeX.";
    throw new LatexError(message);
  }

  const svgNode = adaptor.firstChild(container) as LiteElement | undefined;
  if (!svgNode) {
    throw new LatexError("Unable to render this formula.");
  }

  // 1 ex maps to roughly half the font size, mirroring MathJax's own metrics.
  const exToPx = options.fontSize / 2;
  const widthEx = parseExValue(adaptor.getAttribute(svgNode, "width"));
  const heightEx = parseExValue(adaptor.getAttribute(svgNode, "height"));
  const depthEx = parseVerticalAlignDepthEx(
    adaptor.getAttribute(svgNode, "style"),
  );
  const width = Math.max(1, Math.round(widthEx * exToPx));
  const height = Math.max(1, Math.round(heightEx * exToPx));
  const baselineFromTop = Math.max(1, Math.round((heightEx - depthEx) * exToPx));

  // Pin the SVG to explicit pixel dimensions (the viewBox keeps the aspect
  // ratio intact) and bake the chosen color in place of `currentColor`.
  adaptor.setAttribute(svgNode, "width", `${width}px`);
  adaptor.setAttribute(svgNode, "height", `${height}px`);

  let svg = adaptor.outerHTML(svgNode);
  svg = svg.replace(/currentColor/g, options.color);

  return {
    svg,
    dataUrl: svgToDataUrl(svg),
    width,
    height,
    baselineFromTop,
  };
}
