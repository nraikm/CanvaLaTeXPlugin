import { buildMixedElements, truncateAltText } from "./mixed_layout";

describe("buildMixedElements", () => {
  beforeAll(() => {
    jest
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({
        font: "",
        measureText: (text: string) => ({ width: text.length * 32 }),
      } as unknown as CanvasRenderingContext2D);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it("aligns non-native inline math to normal text baseline", () => {
    const elements = buildMixedElements({
      source: "what's up $x^2$ asdf",
      color: "#000000",
      fontSize: 64,
      mixedRender: "canva",
    });

    const math = elements.find((element) => element.type === "image");

    expect(math).toBeDefined();
    expect(math?.top).toBe(1);
  });

  it("truncates alt text to Canva's 250 character limit", () => {
    expect(truncateAltText("x".repeat(251))).toHaveLength(250);
  });
});
