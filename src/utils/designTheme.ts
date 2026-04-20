interface ThemeCssVariables {
  [cssVariable: string]: string;
}

interface RemoteDesignThemePayload {
  ThemeGlobal?: {
    css?: ThemeCssVariables;
  };
}

type DesignThemeCleanup = () => void;

const normalizeHex = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const shortHex = /^#([a-fA-F0-9]{3})$/;
  const fullHex = /^#([a-fA-F0-9]{6})$/;

  if (fullHex.test(trimmed)) return trimmed.toLowerCase();

  const shortMatch = trimmed.match(shortHex);
  if (!shortMatch) return null;

  const [r, g, b] = shortMatch[1].split("");
  return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
};

const hexToHslChannels = (hex: string): string => {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r:
        h = ((g - b) / delta) % 6;
        break;
      case g:
        h = (b - r) / delta + 2;
        break;
      default:
        h = (r - g) / delta + 4;
        break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }

  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
};

const setSemanticColor = (
  root: HTMLElement,
  cssVariables: ThemeCssVariables,
  sourceVariable: string,
  targetVariable: string,
) => {
  const rawValue = cssVariables[sourceVariable];
  if (typeof rawValue !== "string") return;

  const normalizedHex = normalizeHex(rawValue);
  if (!normalizedHex) return;

  root.style.setProperty(targetVariable, hexToHslChannels(normalizedHex));
};

const applySemanticThemeMappings = (
  root: HTMLElement,
  cssVariables: ThemeCssVariables,
) => {
  setSemanticColor(root, cssVariables, "--theme-color-primary", "--primary");
  setSemanticColor(root, cssVariables, "--theme-color-primary-over", "--primary-foreground");
  setSemanticColor(root, cssVariables, "--theme-color-secondary", "--secondary");
  setSemanticColor(root, cssVariables, "--theme-color-secondary-over", "--secondary-foreground");
  setSemanticColor(root, cssVariables, "--theme-color-alert", "--destructive");
  setSemanticColor(root, cssVariables, "--theme-color-alert-over", "--destructive-foreground");
  setSemanticColor(root, cssVariables, "--theme-color-body-primary", "--background");
  setSemanticColor(root, cssVariables, "--theme-color-body-secondary", "--card");
  setSemanticColor(root, cssVariables, "--theme-color-body-secondary", "--popover");
  setSemanticColor(root, cssVariables, "--theme-color-body-tertiary", "--muted");
  setSemanticColor(root, cssVariables, "--theme-color-body-tertiary", "--secondary");
  setSemanticColor(root, cssVariables, "--theme-color-primary", "--accent");
  setSemanticColor(root, cssVariables, "--theme-color-primary-over", "--accent-foreground");
  setSemanticColor(root, cssVariables, "--theme-color-text-primary", "--foreground");
  setSemanticColor(root, cssVariables, "--theme-color-text-primary", "--card-foreground");
  setSemanticColor(root, cssVariables, "--theme-color-text-primary", "--popover-foreground");
  setSemanticColor(root, cssVariables, "--theme-color-text-secondary", "--secondary-foreground");
  setSemanticColor(root, cssVariables, "--theme-color-text-meta", "--muted-foreground");
  setSemanticColor(root, cssVariables, "--theme-color-primary", "--ring");
  setSemanticColor(root, cssVariables, "--theme-color-disabled-light", "--input");
  setSemanticColor(root, cssVariables, "--theme-color-disabled-light", "--border");

  const radius = cssVariables["--theme-setting-globalradius"];
  if (radius) {
    root.style.setProperty("--radius", radius);
  }

  const primaryFont = cssVariables["--theme-font-family-primary"];
  if (primaryFont) {
    root.style.setProperty("--font-sans", primaryFont);
  }

  const secondaryFont = cssVariables["--theme-font-family-secondary"];
  if (secondaryFont) {
    root.style.setProperty("--font-mono", secondaryFont);
  }

  const primaryShadow = cssVariables["--theme-shadow-primary"];
  if (primaryShadow) {
    root.style.setProperty("--shadow-card", primaryShadow);
  }

  const secondaryShadow = cssVariables["--theme-shadow-secondary"];
  if (secondaryShadow) {
    root.style.setProperty("--shadow-glow", secondaryShadow);
  }

  const globalWidth = cssVariables["--theme-setting-globalwidth"];
  if (globalWidth) {
    root.style.setProperty("--theme-setting-globalwidth", globalWidth);
  }

  const fontSizeXs = cssVariables["--theme-font-size-xs"];
  if (fontSizeXs) {
    root.style.setProperty("--theme-font-size-xs", fontSizeXs);
    root.style.setProperty("--step-indicator-label-size", fontSizeXs);
  }

  const fontSizeS = cssVariables["--theme-font-size-s"];
  if (fontSizeS) {
    root.style.setProperty("--theme-font-size-s", fontSizeS);
    root.style.setProperty("--step-indicator-font-size", fontSizeS);
  }

  const fontSizeM = cssVariables["--theme-font-size-m"];
  if (fontSizeM) {
    root.style.setProperty("--theme-font-size-m", fontSizeM);
  }

  const fontSizeL = cssVariables["--theme-font-size-l"];
  if (fontSizeL) {
    root.style.setProperty("--theme-font-size-l", fontSizeL);
  }

  const fontSizeXl = cssVariables["--theme-font-size-xl"];
  if (fontSizeXl) {
    root.style.setProperty("--theme-font-size-xl", fontSizeXl);
    root.style.setProperty("--theme-heading-card-size", fontSizeXl);
  }

  const fontSizeXxl = cssVariables["--theme-font-size-xxl"];
  if (fontSizeXxl) {
    root.style.setProperty("--theme-font-size-xxl", fontSizeXxl);
    root.style.setProperty("--theme-heading-display-size", fontSizeXxl);
    root.style.setProperty("--theme-heading-section-size", fontSizeXxl);
  }

  const fontWeightPrimary = cssVariables["--theme-font-weight-primary"];
  if (fontWeightPrimary) {
    root.style.setProperty("--theme-font-weight-primary", fontWeightPrimary);
  }

  const fontWeightSecondary = cssVariables["--theme-font-weight-secondary"];
  if (fontWeightSecondary) {
    root.style.setProperty("--theme-font-weight-secondary", fontWeightSecondary);
    root.style.setProperty("--theme-heading-weight", fontWeightSecondary);
  }

  const borderPrimary = cssVariables["--theme-border-primary"];
  if (borderPrimary) {
    root.style.setProperty("--theme-border-primary", borderPrimary);
  }

  const borderSecondary = cssVariables["--theme-border-secondary"];
  if (borderSecondary) {
    root.style.setProperty("--theme-border-secondary", borderSecondary);
  }

  const tableHeaderBody = cssVariables["--theme-table-header-body"];
  if (tableHeaderBody) {
    root.style.setProperty("--theme-table-header-body", tableHeaderBody);
  }

  const tableHeaderText = cssVariables["--theme-table-header-text"];
  if (tableHeaderText) {
    root.style.setProperty("--theme-table-header-text", tableHeaderText);
  }

  const tableRowPrimaryBody = cssVariables["--theme-table-row-primary-body"];
  if (tableRowPrimaryBody) {
    root.style.setProperty("--theme-table-row-primary-body", tableRowPrimaryBody);
  }

  const tableRowPrimaryText = cssVariables["--theme-table-row-primary-text"];
  if (tableRowPrimaryText) {
    root.style.setProperty("--theme-table-row-primary-text", tableRowPrimaryText);
  }

  const tableRowSecondaryBody = cssVariables["--theme-table-row-secondary-body"];
  if (tableRowSecondaryBody) {
    root.style.setProperty("--theme-table-row-secondary-body", tableRowSecondaryBody);
  }

  const tableRowSecondaryText = cssVariables["--theme-table-row-secondary-text"];
  if (tableRowSecondaryText) {
    root.style.setProperty("--theme-table-row-secondary-text", tableRowSecondaryText);
  }

  const tableRowHoverBody = cssVariables["--theme-table-row-hover-body"];
  if (tableRowHoverBody) {
    root.style.setProperty("--theme-table-row-hover-body", tableRowHoverBody);
  }

  const tableRowHoverText = cssVariables["--theme-table-row-hover-text"];
  if (tableRowHoverText) {
    root.style.setProperty("--theme-table-row-hover-text", tableRowHoverText);
  }

  const primaryHex = normalizeHex(cssVariables["--theme-color-primary"] ?? "");
  const secondaryHex = normalizeHex(cssVariables["--theme-color-secondary"] ?? "");
  if (primaryHex && secondaryHex) {
    root.style.setProperty("--gradient-primary", `linear-gradient(135deg, ${primaryHex}, ${secondaryHex})`);
  } else if (primaryHex) {
    root.style.setProperty("--gradient-primary", `linear-gradient(135deg, ${primaryHex}, ${primaryHex})`);
  }
};

const getThemeCssVariables = (payload: unknown): ThemeCssVariables | null => {
  if (!payload || typeof payload !== "object") return null;

  const themeGlobal = (payload as RemoteDesignThemePayload).ThemeGlobal;
  if (!themeGlobal || typeof themeGlobal !== "object") return null;

  const cssVariables = themeGlobal.css;
  if (!cssVariables || typeof cssVariables !== "object") return null;

  return Object.entries(cssVariables).reduce<ThemeCssVariables>((acc, [key, value]) => {
    if (key.startsWith("--") && typeof value === "string") {
      acc[key] = value;
    }
    return acc;
  }, {});
};

export const applyRemoteDesignTheme = (cssVariables: ThemeCssVariables): DesignThemeCleanup => {
  const root = document.documentElement;
  const previousValues: Record<string, string> = {};

  Object.entries(cssVariables).forEach(([key, value]) => {
    if (!(key in previousValues)) {
      previousValues[key] = root.style.getPropertyValue(key);
    }
    root.style.setProperty(key, value);
  });

  const mappedVariables = [
    "--primary",
    "--primary-foreground",
    "--secondary",
    "--secondary-foreground",
    "--destructive",
    "--destructive-foreground",
    "--background",
    "--card",
    "--popover",
    "--muted",
    "--accent",
    "--accent-foreground",
    "--foreground",
    "--card-foreground",
    "--popover-foreground",
    "--muted-foreground",
    "--ring",
    "--input",
    "--border",
    "--radius",
    "--font-sans",
    "--font-mono",
    "--shadow-card",
    "--shadow-glow",
    "--theme-setting-globalwidth",
    "--theme-font-size-xs",
    "--theme-font-size-s",
    "--theme-font-size-m",
    "--theme-font-size-l",
    "--theme-font-size-xl",
    "--theme-font-size-xxl",
    "--theme-heading-card-size",
    "--theme-heading-display-size",
    "--theme-heading-section-size",
    "--theme-font-weight-primary",
    "--theme-font-weight-secondary",
    "--theme-heading-weight",
    "--theme-border-primary",
    "--theme-border-secondary",
    "--theme-table-header-body",
    "--theme-table-header-text",
    "--theme-table-row-primary-body",
    "--theme-table-row-primary-text",
    "--theme-table-row-secondary-body",
    "--theme-table-row-secondary-text",
    "--theme-table-row-hover-body",
    "--theme-table-row-hover-text",
    "--gradient-primary",
    "--step-indicator-label-size",
    "--step-indicator-font-size",
  ];

  mappedVariables.forEach((key) => {
    if (!(key in previousValues)) {
      previousValues[key] = root.style.getPropertyValue(key);
    }
  });

  applySemanticThemeMappings(root, cssVariables);

  return () => {
    Object.entries(previousValues).forEach(([key, value]) => {
      if (value) root.style.setProperty(key, value);
      else root.style.removeProperty(key);
    });
  };
};

export const loadAndApplyDesignThemeFromUrl = async (
  url: string,
): Promise<DesignThemeCleanup> => {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) return () => {};

  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/theme-proxy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      "x-theme-url": trimmedUrl,
    },
  });

  if (!response.ok) {
    throw new Error(`Theme request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  const cssVariables = getThemeCssVariables(payload);

  if (!cssVariables) {
    throw new Error("Theme payload does not contain ThemeGlobal.css variables");
  }

  return applyRemoteDesignTheme(cssVariables);
};

export const loadAndApplyStartupDesignTheme = async (
  url = import.meta.env.VITE_DESIGN_THEME_URL,
): Promise<void> => {
  if (!url) return;

  try {
    const attempts: Array<() => Promise<Response>> = [];
    const envDesignThemeUrl = import.meta.env.VITE_DESIGN_THEME_URL;

    if (import.meta.env.DEV && url === envDesignThemeUrl) {
      attempts.push(() => fetch("/__design-theme__"));
    }

    if (import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
      attempts.push(() =>
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/theme-proxy`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            "x-theme-url": url,
          },
        }),
      );
    }

    let lastError: Error | null = null;

    for (const attempt of attempts) {
      try {
        const response = await attempt();
        if (!response.ok) {
          throw new Error(`Theme request failed with status ${response.status}`);
        }

        const payload = (await response.json()) as unknown;
        const cssVariables = getThemeCssVariables(payload);

        if (!cssVariables) {
          throw new Error("Theme payload does not contain ThemeGlobal.css variables");
        }

        applyRemoteDesignTheme(cssVariables);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    throw lastError ?? new Error("No theme loading strategy succeeded");
  } catch (error) {
    console.warn("Failed to load startup design theme", error);
  }
};
