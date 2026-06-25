import {
  Alert,
  Box,
  Button,
  FormField,
  Grid,
  ImageCard,
  LinkButton,
  MultilineInput,
  NumberInput,
  Rows,
  SegmentedControl,
  Select,
  StarFilledIcon,
  StarIcon,
  Swatch,
  Switch,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
  TrashIcon,
} from "@canva/app-ui-kit";
import { type AppElementOptions, initAppElement } from "@canva/design";
import {
  type Anchor,
  type ColorSelectionEvent,
  type ColorSelectionScope,
  findFonts,
  openColorSelector,
  requestFontSelection,
} from "@canva/asset";
import { requestOpenExternalUrl } from "@canva/platform";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { FormattedMessage, useIntl } from "react-intl";
import * as styles from "styles/latex.css";
import { LatexError, renderLatex } from "../../../utils/latex_renderer";
import {
  buildMixedElements,
  hasMath,
  type MixedRenderMode,
  renderMixedPreview,
  truncateAltText,
} from "../../../utils/mixed_layout";

const LATEX_GUIDE_URL = "https://en.wikibooks.org/wiki/LaTeX/Mathematics";

const STORAGE_KEYS = {
  recent: "canva-latex-recent",
  favorites: "canva-latex-favorites",
  showExamples: "canva-latex-show-examples",
} as const;

const MAX_RECENT = 12;
const MAX_FAVORITES = 50;
const MIN_FONT_SIZE = 4;
const MAX_FONT_SIZE = 400;
const FONT_SIZE_STEP = 1;
/** The largest font size Canva allows on a native text element (mixed mode). */
const MAX_TEXT_FONT_SIZE = 100;

const DEFAULT_FONT_SIZE = 44;

/**
 * - `formula`: a single rendered equation image.
 * - `mixed`: prose with inline `$...$` math, inserted as a group of native text
 *   and inline math image elements.
 */
type RenderMode = "formula" | "mixed";

/**
 * The data persisted on each LaTeX app element. Because app elements re-run the
 * `render` function from this data, storing the source (rather than the rendered
 * image) keeps everything fully re-editable and well under the 5KB app-element
 * data limit.
 */
type LatexElementData = {
  mode: RenderMode;
  /** LaTeX source (`formula`) or prose with inline `$...$` math (`mixed`). */
  latex: string;
  displayMode: boolean;
  color: string;
  fontSize: number;
  /** Canva font applied to the prose in `mixed` + `canva` render mode. */
  fontRef?: string;
  /**
   * How mixed-mode content is inserted: LaTeX typography (`native`) or editable
   * Canva text with inline math (`canva`).
   */
  mixedRender: MixedRenderMode;
};

type UpdateFn = (opts: AppElementOptions<LatexElementData>) => Promise<void>;

const INITIAL_DATA: LatexElementData = {
  mode: "formula",
  latex: "",
  displayMode: true,
  color: "#000000",
  fontSize: DEFAULT_FONT_SIZE,
  mixedRender: "native",
};

// The app element client must be created outside of the React component, since
// its `render` function is invoked by Canva independently of React rendering.
const appElementClient = initAppElement<LatexElementData>({
  render: (data) => {
    if (data.mode === "mixed") {
      return buildMixedElements({
        source: data.latex,
        color: data.color,
        fontSize: data.fontSize,
        fontRef: data.fontRef,
        mixedRender: data.mixedRender,
      });
    }

    const { dataUrl, width, height } = renderLatex(data.latex, {
      displayMode: data.displayMode,
      color: data.color,
      fontSize: data.fontSize,
    });

    return [
      {
        type: "image",
        dataUrl,
        width,
        height,
        top: 0,
        left: 0,
        altText: { text: truncateAltText(data.latex), decorative: false },
      },
    ];
  },
});

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Best-effort persistence: storage may be unavailable inside the sandboxed
    // iframe. React state remains the source of truth either way.
  }
}

/**
 * Like `useState`, but the value is mirrored to `localStorage` on every change
 * and restored on mount. React state is always the source of truth, so the
 * feature keeps working for the current session even if storage is blocked.
 */
function usePersistentState<T>(
  key: string,
  initial: T,
): [T, (updater: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => readJson(key, initial));
  const update = useCallback(
    (updater: T | ((prev: T) => T)) => {
      setState((prev) => {
        const next =
          typeof updater === "function"
            ? (updater as (p: T) => T)(prev)
            : updater;
        writeJson(key, next);
        return next;
      });
    },
    [key],
  );
  return [state, update];
}

function prependUnique(list: string[], value: string, max: number): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return list;
  }
  return [trimmed, ...list.filter((item) => item !== trimmed)].slice(0, max);
}

function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) {
    return MIN_FONT_SIZE;
  }
  const clamped = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, value));
  return Math.round(clamped * 10) / 10;
}

function formatFontSize(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

type PreviewState =
  | { kind: "empty" }
  | { kind: "ok"; dataUrl: string; width: number; height: number }
  | { kind: "error"; message: string };

export const App = () => {
  const intl = useIntl();
  const [data, setData] = useState<LatexElementData>(INITIAL_DATA);
  const [updateFn, setUpdateFn] = useState<UpdateFn | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("new");
  const [fontName, setFontName] = useState<string | undefined>(undefined);

  const [recent, setRecent] = usePersistentState<string[]>(
    STORAGE_KEYS.recent,
    [],
  );
  const [favorites, setFavorites] = usePersistentState<string[]>(
    STORAGE_KEYS.favorites,
    [],
  );
  const [showExamples, setShowExamples] = usePersistentState<boolean>(
    STORAGE_KEYS.showExamples,
    true,
  );
  /** Local string while the size NumberInput is being edited; `null` = show committed size. */
  const [sizeDraft, setSizeDraft] = useState<string | null>(null);

  // Keep the UI in sync with the user's selection. When a LaTeX app element is
  // selected, load its data so it can be edited; the `update` function lets us
  // write changes back to that same element.
  useEffect(() => {
    appElementClient.registerOnElementChange((element) => {
      if (element) {
        // Spread over the defaults so elements created by older versions of the
        // app (which lack `mode`/`fontRef`) still load cleanly.
        setData({ ...INITIAL_DATA, ...element.data });
        setUpdateFn(() => element.update);
        setActiveTab("new");
      } else {
        setUpdateFn(() => undefined);
      }
    });
  }, []);

  // Resolve the human-readable font name whenever the selected font changes.
  useEffect(() => {
    let cancelled = false;
    const ref = data.fontRef;
    if (!ref) {
      setFontName(undefined);
      return;
    }
    findFonts({ fontRefs: [ref as never] })
      .then((response) => {
        if (!cancelled) {
          setFontName(response.fonts[0]?.name);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFontName(undefined);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [data.fontRef]);

  const patch = useCallback((changes: Partial<LatexElementData>) => {
    setData((prev) => ({ ...prev, ...changes }));
  }, []);

  const preview = useMemo<PreviewState>(() => {
    if (data.latex.trim().length === 0) {
      return { kind: "empty" };
    }
    try {
      const { dataUrl, width, height } =
        data.mode === "mixed"
          ? renderMixedPreview({
              source: data.latex,
              color: data.color,
              fontSize: data.fontSize,
            })
          : renderLatex(data.latex, {
              displayMode: data.displayMode,
              color: data.color,
              fontSize: data.fontSize,
            });
      return { kind: "ok", dataUrl, width, height };
    } catch (error) {
      const message =
        error instanceof LatexError || error instanceof Error
          ? error.message
          : intl.formatMessage({
              defaultMessage: "That doesn't look like valid LaTeX.",
              description:
                "Generic error shown when a LaTeX formula cannot be rendered.",
            });
      return { kind: "error", message };
    }
  }, [
    data.mode,
    data.latex,
    data.displayMode,
    data.color,
    data.fontSize,
    intl,
  ]);

  const canSubmit = preview.kind === "ok";

  const onSubmit = useCallback(async () => {
    if (preview.kind !== "ok") {
      return;
    }
    setBusy(true);
    setSubmitError(null);
    try {
      if (updateFn) {
        await updateFn({ data });
      } else {
        await appElementClient.addElement({ data });
      }
      // Recents hold pure LaTeX formulas, so only track those.
      if (data.mode === "formula") {
        setRecent((prev) => prependUnique(prev, data.latex, MAX_RECENT));
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message.length > 0
          ? error.message
          : intl.formatMessage({
              defaultMessage:
                "Something went wrong adding your formula. Please try again.",
              description:
                "Error shown when inserting or updating a formula fails.",
            });
      setSubmitError(
        intl.formatMessage(
          {
            defaultMessage: "Couldn’t add this to the design: {message}",
            description:
              "Error shown when inserting or updating content fails with details.",
          },
          { message },
        ),
      );
    } finally {
      setBusy(false);
    }
  }, [preview.kind, updateFn, data, intl, setRecent]);

  const trimmedLatex = data.latex.trim();
  const isFavorite =
    trimmedLatex.length > 0 && favorites.includes(trimmedLatex);

  const toggleFavorite = useCallback(() => {
    if (!trimmedLatex) {
      return;
    }
    setFavorites((prev) =>
      prev.includes(trimmedLatex)
        ? prev.filter((item) => item !== trimmedLatex)
        : [trimmedLatex, ...prev].slice(0, MAX_FAVORITES),
    );
  }, [trimmedLatex, setFavorites]);

  const onColorSelect = useCallback(
    async <T extends ColorSelectionScope>(event: ColorSelectionEvent<T>) => {
      if (event.selection.type === "solid") {
        patch({ color: event.selection.hexString });
      }
    },
    [patch],
  );

  const openColor = useCallback(
    (anchor: Anchor) => {
      openColorSelector(anchor, { onColorSelect, scopes: ["solid"] });
    },
    [onColorSelect],
  );

  const openGuide = useCallback(async () => {
    await requestOpenExternalUrl({ url: LATEX_GUIDE_URL });
  }, []);

  // Native mixed mode renders LaTeX SVGs; Canva-text mode uses native text (capped).
  const sizeMax =
    data.mode === "mixed" && data.mixedRender === "canva"
      ? MAX_TEXT_FONT_SIZE
      : MAX_FONT_SIZE;

  const sizeValue = Math.min(
    sizeMax,
    Math.max(MIN_FONT_SIZE, clampFontSize(data.fontSize)),
  );

  const applySize = useCallback(
    (rawValue: number) => {
      if (!Number.isFinite(rawValue)) {
        return;
      }
      patch({ fontSize: Math.min(sizeMax, clampFontSize(rawValue)) });
    },
    [patch, sizeMax],
  );

  const commitSizeDraft = useCallback(() => {
    setSizeDraft((draft) => {
      if (draft == null || draft === "") {
        return null;
      }
      const parsed = Number(draft);
      if (Number.isFinite(parsed)) {
        applySize(parsed);
      }
      return null;
    });
  }, [applySize]);

  useEffect(() => {
    setSizeDraft(null);
  }, [sizeValue]);

  const examples = useMemo(
    () => [
      {
        label: intl.formatMessage({
          defaultMessage: "Quadratic",
          description: "Name of the quadratic formula example.",
        }),
        latex: "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
      },
      {
        label: intl.formatMessage({
          defaultMessage: "Euler",
          description: "Name of Euler's identity example.",
        }),
        latex: "e^{i\\pi} + 1 = 0",
      },
      {
        label: intl.formatMessage({
          defaultMessage: "Sum",
          description: "Name of the summation example.",
        }),
        latex: "\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}",
      },
      {
        label: intl.formatMessage({
          defaultMessage: "Integral",
          description: "Name of the integral example.",
        }),
        latex: "\\int_{a}^{b} f(x)\\,dx",
      },
    ],
    [intl],
  );

  const loadFormula = useCallback(
    (latex: string) => {
      patch({ latex, mode: hasMath(latex) ? "mixed" : "formula" });
      setActiveTab("new");
    },
    [patch],
  );

  const chooseFont = useCallback(async () => {
    const response = await requestFontSelection({
      selectedFontRef: data.fontRef as never,
    });
    if (response.type === "completed") {
      patch({ fontRef: response.font.ref });
      setFontName(response.font.name);
    }
  }, [data.fontRef, patch]);

  const onInputKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (canSubmit && !busy) {
          void onSubmit();
        }
      }
    },
    [canSubmit, busy, onSubmit],
  );

  const modeOptions = useMemo(
    () => [
      {
        value: "formula",
        label: intl.formatMessage({
          defaultMessage: "Formula",
          description: "Mode that inserts a single equation.",
        }),
      },
      {
        value: "mixed",
        label: intl.formatMessage({
          defaultMessage: "Text + Math",
          description: "Mode that inserts prose with inline math.",
        }),
      },
    ],
    [intl],
  );

  const fontSizeOptions = useMemo(() => {
    const useTextSizes = data.mode === "mixed" && data.mixedRender === "canva";
    const base = useTextSizes
      ? [
          8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 84, 96,
          100,
        ]
      : [
          8, 12, 16, 20, 24, 28, 32, 40, 48, 64, 80, 96, 120, 144, 180, 216,
          256, 300, 360, 400,
        ];
    const values = Array.from(new Set([...base, sizeValue])).sort(
      (a, b) => a - b,
    );
    return values.map((value) => ({
      value,
      label: intl.formatMessage(
        {
          defaultMessage: "{size} px",
          description: "A selectable text size, in pixels.",
        },
        { size: value },
      ),
    }));
  }, [intl, data.mode, data.mixedRender, sizeValue]);

  const submitLabel = updateFn
    ? intl.formatMessage({
        defaultMessage: "Update selected",
        description:
          "Button label that saves changes to the currently selected element.",
      })
    : intl.formatMessage({
        defaultMessage: "Add to design",
        description: "Button label that inserts content into the design.",
      });

  return (
    <div className={styles.appScroll}>
      <Rows spacing="2u">
        <Tabs>
          <TabList>
            <Tab id="new" active={activeTab === "new"} onClick={setActiveTab}>
              <FormattedMessage
                defaultMessage="New"
                description="Tab for composing a new formula."
              />
            </Tab>
            <Tab
              id="recent"
              active={activeTab === "recent"}
              onClick={setActiveTab}
            >
              <FormattedMessage
                defaultMessage="Recent"
                description="Tab listing recently used formulas."
              />
            </Tab>
            <Tab
              id="favorites"
              active={activeTab === "favorites"}
              onClick={setActiveTab}
            >
              <FormattedMessage
                defaultMessage="Favorites"
                description="Tab listing favorited formulas."
              />
            </Tab>
          </TabList>
          <TabPanels>
            <TabPanel id="new" active={activeTab === "new"}>
              <Box paddingTop="2u">
                <Rows spacing="2u">
                  <SegmentedControl
                    options={modeOptions}
                    value={data.mode}
                    onChange={(value) => patch({ mode: value as RenderMode })}
                  />

                  {updateFn ? (
                    <Alert tone="info">
                      <FormattedMessage
                        defaultMessage="Editing the selected element. Your changes update it in place."
                        description="Banner shown when an app element is selected for editing."
                      />
                    </Alert>
                  ) : null}

                  {preview.kind === "ok" ? (
                    <ImageCard
                      thumbnailUrl={preview.dataUrl}
                      alt={intl.formatMessage({
                        defaultMessage: "Rendered LaTeX formula preview",
                        description: "Alt text for the formula preview image.",
                      })}
                      thumbnailBackground="secondary"
                      thumbnailPadding="2u"
                      borderRadius="standard"
                    />
                  ) : (
                    <Box
                      background="neutralSubtle"
                      borderRadius="large"
                      padding="3u"
                    >
                      <Text
                        size="small"
                        tone={
                          preview.kind === "error" ? "critical" : "tertiary"
                        }
                        alignment="center"
                      >
                        {preview.kind === "error" ? (
                          preview.message
                        ) : (
                          <FormattedMessage
                            defaultMessage="Your formula preview will appear here."
                            description="Placeholder shown in the preview when there is no formula yet."
                          />
                        )}
                      </Text>
                    </Box>
                  )}

                  <FormField
                    label={
                      data.mode === "mixed"
                        ? intl.formatMessage({
                            defaultMessage: "Text with inline LaTeX",
                            description:
                              "Label for the mixed text and math input field.",
                          })
                        : intl.formatMessage({
                            defaultMessage: "LaTeX formula",
                            description: "Label for the LaTeX input field.",
                          })
                    }
                    control={(props) => (
                      <MultilineInput
                        {...props}
                        value={data.latex}
                        placeholder={
                          data.mode === "mixed"
                            ? intl.formatMessage({
                                defaultMessage:
                                  "certainly $x^2 + 2ac$ is appropriate",
                                description:
                                  "Placeholder for the mixed text and math input.",
                              })
                            : intl.formatMessage({
                                defaultMessage: "Example: a^2 + b^2 = c^2",
                                description:
                                  "Placeholder for the LaTeX input field.",
                              })
                        }
                        minRows={3}
                        autoGrow
                        error={preview.kind === "error"}
                        onChange={(value) => patch({ latex: value })}
                        onKeyDown={onInputKeyDown}
                      />
                    )}
                  />

                  {data.mode === "mixed" ? (
                    <Switch
                      value={data.mixedRender === "native"}
                      label={intl.formatMessage({
                        defaultMessage: "Native LaTeX text",
                        description:
                          "Toggle label for rendering all text and math in LaTeX typography.",
                      })}
                      onChange={(value) =>
                        patch({ mixedRender: value ? "native" : "canva" })
                      }
                    />
                  ) : null}

                  {data.mode === "mixed" && data.mixedRender === "canva" ? (
                    <FormField
                      label={intl.formatMessage({
                        defaultMessage: "Font",
                        description: "Label for the text font selector.",
                      })}
                      control={() => (
                        <Box
                          display="flex"
                          justifyContent="spaceBetween"
                          alignItems="center"
                        >
                          <Text size="small" tone="tertiary">
                            {fontName ??
                              intl.formatMessage({
                                defaultMessage: "Default font",
                                description:
                                  "Shown when no specific font is selected.",
                              })}
                          </Text>
                          <Button variant="secondary" onClick={chooseFont}>
                            {intl.formatMessage({
                              defaultMessage: "Change",
                              description: "Button to open the font picker.",
                            })}
                          </Button>
                        </Box>
                      )}
                    />
                  ) : null}

                  {data.mode === "formula" && showExamples ? (
                    <Rows spacing="1u">
                      <Box
                        display="flex"
                        justifyContent="spaceBetween"
                        alignItems="center"
                      >
                        <Text size="small">
                          <FormattedMessage
                            defaultMessage="Examples"
                            description="Heading for the list of example formulas."
                          />
                        </Text>
                        <LinkButton
                          onClick={() => setShowExamples(false)}
                          ariaLabel={intl.formatMessage({
                            defaultMessage: "Hide examples",
                            description:
                              "Link that hides the examples section.",
                          })}
                        >
                          {intl.formatMessage({
                            defaultMessage: "Hide",
                            description:
                              "Link that hides the examples section.",
                          })}
                        </LinkButton>
                      </Box>
                      <Box display="flex" flexWrap="wrap">
                        {examples.map((example) => (
                          <Box key={example.label} padding="0.5u">
                            <Button
                              variant="tertiary"
                              onClick={() => patch({ latex: example.latex })}
                            >
                              {example.label}
                            </Button>
                          </Box>
                        ))}
                      </Box>
                    </Rows>
                  ) : null}

                  {data.mode === "formula" ? (
                    <Switch
                      value={!data.displayMode}
                      label={intl.formatMessage({
                        defaultMessage: "Inline",
                        description:
                          "Toggle label to render the formula inline instead of as a centered block.",
                      })}
                      onChange={(value) => patch({ displayMode: !value })}
                    />
                  ) : null}

                  <FormField
                    label={intl.formatMessage({
                      defaultMessage: "Size",
                      description: "Label for the size selector.",
                    })}
                    control={() => (
                      <div className={styles.sizeRow}>
                        <Select
                          stretch
                          options={fontSizeOptions}
                          value={sizeValue}
                          onChange={(value) => {
                            applySize(value);
                            setSizeDraft(null);
                          }}
                        />
                        <NumberInput
                          value={sizeDraft ?? formatFontSize(sizeValue)}
                          min={MIN_FONT_SIZE}
                          max={sizeMax}
                          step={FONT_SIZE_STEP}
                          maximumFractionDigits={1}
                          hasSpinButtons
                          decrementAriaLabel={intl.formatMessage({
                            defaultMessage: "Decrease size",
                            description:
                              "Accessible label for the decrease font size control.",
                          })}
                          incrementAriaLabel={intl.formatMessage({
                            defaultMessage: "Increase size",
                            description:
                              "Accessible label for the increase font size control.",
                          })}
                          onChange={(_valueAsNumber, valueAsString) => {
                            setSizeDraft(valueAsString);
                          }}
                          onChangeComplete={(value) => {
                            if (value != null) {
                              applySize(value);
                            }
                            setSizeDraft(null);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              commitSizeDraft();
                            }
                          }}
                        />
                      </div>
                    )}
                  />

                  <FormField
                    label={intl.formatMessage({
                      defaultMessage: "Color",
                      description: "Label for the formula color selector.",
                    })}
                    control={() => (
                      <Swatch
                        fill={[data.color]}
                        onClick={(event) =>
                          openColor(event.currentTarget.getBoundingClientRect())
                        }
                      />
                    )}
                  />

                  {submitError ? (
                    <Alert
                      tone="critical"
                      onDismiss={() => setSubmitError(null)}
                    >
                      {submitError}
                    </Alert>
                  ) : null}

                  <div className={styles.submitRow}>
                    <Button
                      variant="primary"
                      onClick={onSubmit}
                      loading={busy}
                      disabled={busy || !canSubmit}
                      stretch
                    >
                      {submitLabel}
                    </Button>
                    <Button
                      variant="secondary"
                      icon={isFavorite ? StarFilledIcon : StarIcon}
                      onClick={toggleFavorite}
                      disabled={!canSubmit}
                      ariaLabel={
                        isFavorite
                          ? intl.formatMessage({
                              defaultMessage: "Remove from favorites",
                              description:
                                "Button to remove the current input from favorites.",
                            })
                          : intl.formatMessage({
                              defaultMessage: "Save to favorites",
                              description:
                                "Button to save the current input to favorites.",
                            })
                      }
                      tooltipLabel={
                        isFavorite
                          ? intl.formatMessage({
                              defaultMessage: "Remove from favorites",
                              description:
                                "Tooltip to remove the current input from favorites.",
                            })
                          : intl.formatMessage({
                              defaultMessage: "Save to favorites",
                              description:
                                "Tooltip to save the current input to favorites.",
                            })
                      }
                    />
                  </div>

                  <Box display="flex" justifyContent="center">
                    <LinkButton
                      onClick={openGuide}
                      ariaLabel={intl.formatMessage({
                        defaultMessage: "Learn LaTeX math syntax",
                        description: "Link to an external LaTeX syntax guide.",
                      })}
                    >
                      {intl.formatMessage({
                        defaultMessage: "Learn LaTeX math syntax",
                        description: "Link to an external LaTeX syntax guide.",
                      })}
                    </LinkButton>
                  </Box>
                </Rows>
              </Box>
            </TabPanel>

            <TabPanel id="recent" active={activeTab === "recent"}>
              <Box paddingTop="2u">
                <Rows spacing="1u">
                  {recent.length > 0 ? (
                    <Box display="flex" justifyContent="end">
                      <LinkButton
                        variant="critical"
                        onClick={() => setRecent([])}
                        ariaLabel={intl.formatMessage({
                          defaultMessage: "Clear recent formulas",
                          description:
                            "Link to clear the recent formulas list.",
                        })}
                      >
                        {intl.formatMessage({
                          defaultMessage: "Clear",
                          description:
                            "Link to clear the recent formulas list.",
                        })}
                      </LinkButton>
                    </Box>
                  ) : null}
                  <FormulaGrid
                    items={recent}
                    onSelect={loadFormula}
                    emptyMessage={
                      <FormattedMessage
                        defaultMessage="Formulas you add will show up here for quick reuse."
                        description="Empty state for the Recent tab."
                      />
                    }
                  />
                </Rows>
              </Box>
            </TabPanel>

            <TabPanel id="favorites" active={activeTab === "favorites"}>
              <Box paddingTop="2u">
                <FormulaGrid
                  items={favorites}
                  onSelect={loadFormula}
                  onRemove={(latex) =>
                    setFavorites((prev) =>
                      prev.filter((item) => item !== latex),
                    )
                  }
                  emptyMessage={
                    <FormattedMessage
                      defaultMessage="Save something with “Save to favorites” to keep it here."
                      description="Empty state for the Favorites tab."
                    />
                  }
                />
              </Box>
            </TabPanel>
          </TabPanels>
        </Tabs>
      </Rows>
    </div>
  );
};

type FormulaGridProps = {
  items: string[];
  emptyMessage: ReactNode;
  onSelect: (latex: string) => void;
  onRemove?: (latex: string) => void;
};

const FormulaGrid = ({
  items,
  emptyMessage,
  onSelect,
  onRemove,
}: FormulaGridProps) => {
  if (items.length === 0) {
    return (
      <Text size="small" tone="tertiary" alignment="center">
        {emptyMessage}
      </Text>
    );
  }

  return (
    <Grid columns={2} spacing="1u">
      {items.map((latex) => (
        <FormulaCard
          key={latex}
          latex={latex}
          onSelect={onSelect}
          onRemove={onRemove}
        />
      ))}
    </Grid>
  );
};

type FormulaCardProps = {
  latex: string;
  onSelect: (latex: string) => void;
  onRemove?: (latex: string) => void;
};

const FormulaCard = ({ latex, onSelect, onRemove }: FormulaCardProps) => {
  const intl = useIntl();
  const thumbnail = useMemo(() => {
    try {
      return hasMath(latex)
        ? renderMixedPreview({
            source: latex,
            color: "#000000",
            fontSize: 28,
          }).dataUrl
        : renderLatex(latex, {
            displayMode: false,
            color: "#000000",
            fontSize: 28,
          }).dataUrl;
    } catch {
      return undefined;
    }
  }, [latex]);

  const card = thumbnail ? (
    <ImageCard
      thumbnailUrl={thumbnail}
      alt={latex}
      ariaLabel={intl.formatMessage({
        defaultMessage: "Insert this saved item",
        description: "Accessible label for a saved item card.",
      })}
      thumbnailBackground="secondary"
      thumbnailPadding="1u"
      borderRadius="standard"
      onClick={() => onSelect(latex)}
    />
    ) : (
      <Button
        variant="secondary"
        stretch
        alignment="start"
        onClick={() => onSelect(latex)}
        ariaLabel={intl.formatMessage({
          defaultMessage: "Insert this saved item",
          description: "Accessible label for a saved text item card.",
        })}
      >
        {latex}
      </Button>
    );

  if (!onRemove) {
    return card;
  }

  return (
    <div className={styles.favoriteCardWrap}>
      {card}
      <div className={styles.favoriteTrash}>
        <LinkButton
          variant="critical"
          onClick={() => onRemove(latex)}
          ariaLabel={intl.formatMessage({
            defaultMessage: "Remove from favorites",
            description: "Accessible label for the favorite remove button.",
          })}
          tooltipLabel={intl.formatMessage({
            defaultMessage: "Remove from favorites",
            description: "Tooltip for the favorite remove button.",
          })}
        >
          <TrashIcon />
        </LinkButton>
      </div>
    </div>
  );
};
