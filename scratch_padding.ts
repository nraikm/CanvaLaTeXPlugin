import { readFileSync, writeFileSync } from "fs";

let content = readFileSync("utils/latex_renderer.ts", "utf-8");
content = content.replace(
  /const PADDING_EX = 0\.2;/,
  "const PADDING_X_EX = 0;\n  const PADDING_Y_EX = 0.2;"
);
content = content.replace(
  /const widthEx = originalWidthEx \+ PADDING_EX \* 2;/,
  "const widthEx = originalWidthEx + PADDING_X_EX * 2;"
);
content = content.replace(
  /const heightEx = originalHeightEx \+ PADDING_EX \* 2;/,
  "const heightEx = originalHeightEx + PADDING_Y_EX * 2;"
);
content = content.replace(
  /const depthEx = originalDepthEx \+ PADDING_EX;/,
  "const depthEx = originalDepthEx + PADDING_Y_EX;"
);
content = content.replace(
  /const paddingViewBox = PADDING_EX \* exToViewBox;/,
  "const paddingViewBoxX = PADDING_X_EX * exToViewBox;\n      const paddingViewBoxY = PADDING_Y_EX * exToViewBox;"
);
content = content.replace(
  /const newMinX = parts\[0\] - paddingViewBox;/,
  "const newMinX = parts[0] - paddingViewBoxX;"
);
content = content.replace(
  /const newMinY = parts\[1\] - paddingViewBox;/,
  "const newMinY = parts[1] - paddingViewBoxY;"
);
content = content.replace(
  /const newWidth = parts\[2\] \+ paddingViewBox \* 2;/,
  "const newWidth = parts[2] + paddingViewBoxX * 2;"
);
content = content.replace(
  /const newHeight = parts\[3\] \+ paddingViewBox \* 2;/,
  "const newHeight = parts[3] + paddingViewBoxY * 2;"
);

writeFileSync("utils/latex_renderer.ts", content);
