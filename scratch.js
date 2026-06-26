const { liteAdaptor } = require("mathjax-full/js/adaptors/liteAdaptor.js");
const { RegisterHTMLHandler } = require("mathjax-full/js/handlers/html.js");
const { TeX } = require("mathjax-full/js/input/tex.js");
const { AllPackages } = require("mathjax-full/js/input/tex/AllPackages.js");
const { mathjax } = require("mathjax-full/js/mathjax.js");
const { SVG } = require("mathjax-full/js/output/svg.js");

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const texInput = new TeX({ packages: AllPackages });
const svgOutput = new SVG({ fontCache: "local" });
const mathDocument = mathjax.document("", { InputJax: texInput, OutputJax: svgOutput });

function parseExValue(value) {
  if (!value) return 0;
  const parsed = Number.parseFloat(value.replace("ex", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseVerticalAlignDepthEx(style) {
  const match = style?.match(/vertical-align:\s*(-?[\d.]+)ex/);
  if (!match) return 0;
  return Math.abs(Number.parseFloat(match[1] || "0"));
}

const container = mathDocument.convert("\\lower0.08em{\\text{asdf}}", { display: false });
const svgNode = adaptor.firstChild(container);

const exToPx = 44 / 2;
const PADDING_EX = 0.2;

const originalWidthEx = parseExValue(adaptor.getAttribute(svgNode, "width"));
const originalHeightEx = parseExValue(adaptor.getAttribute(svgNode, "height"));
const originalDepthEx = parseVerticalAlignDepthEx(adaptor.getAttribute(svgNode, "style"));

const widthEx = originalWidthEx + PADDING_EX * 2;
const heightEx = originalHeightEx + PADDING_EX * 2;
const depthEx = originalDepthEx + PADDING_EX;

const width = Math.max(1, Math.round(widthEx * exToPx));
const height = Math.max(1, Math.round(heightEx * exToPx));
const baselineFromTop = Math.max(1, Math.round((heightEx - depthEx) * exToPx));

const viewBoxStr = adaptor.getAttribute(svgNode, "viewBox");
if (viewBoxStr) {
  const parts = viewBoxStr.split(" ").map(Number);
  if (parts.length === 4) {
    const exToViewBox = originalWidthEx > 0 ? parts[2] / originalWidthEx : 430.554;
    const paddingViewBox = PADDING_EX * exToViewBox;
    const newMinX = parts[0] - paddingViewBox;
    const newMinY = parts[1] - paddingViewBox;
    const newWidth = parts[2] + paddingViewBox * 2;
    const newHeight = parts[3] + paddingViewBox * 2;
    adaptor.setAttribute(
      svgNode,
      "viewBox",
      `${newMinX} ${newMinY} ${newWidth} ${newHeight}`
    );
  }
}

adaptor.setAttribute(svgNode, "width", `${width}px`);
adaptor.setAttribute(svgNode, "height", `${height}px`);
adaptor.removeAttribute(svgNode, "style");

console.log(adaptor.outerHTML(svgNode).substring(0, 300));
