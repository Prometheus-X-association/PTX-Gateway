import { loadAndApplyDesignThemeFromUrl } from "@/utils/designTheme";

export interface VisualizationSettings {
  favicon_url?: string;
  primary_color?: string;
  accent_color?: string;
  background_color?: string;
  card_color?: string;
  design_url?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeHex = (value: string): string | null => {
  const v = value.trim();
  if (!v) return null;
  const shortHex = /^#([a-fA-F0-9]{3})$/;
  const fullHex = /^#([a-fA-F0-9]{6})$/;

  if (fullHex.test(v)) return v.toLowerCase();
  const short = v.match(shortHex);
  if (short) {
    const [r, g, b] = short[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
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

export const getVisualizationSettingsFromOrgSettings = (
  settings: unknown
): VisualizationSettings => {
  if (!isRecord(settings)) return {};
  const raw = settings.visualization;
  if (!isRecord(raw)) return {};
  return {
    favicon_url: typeof raw.favicon_url === "string" ? raw.favicon_url : undefined,
    primary_color: typeof raw.primary_color === "string" ? raw.primary_color : undefined,
    accent_color: typeof raw.accent_color === "string" ? raw.accent_color : undefined,
    background_color:
      typeof raw.background_color === "string" ? raw.background_color : undefined,
    card_color: typeof raw.card_color === "string" ? raw.card_color : undefined,
    design_url: typeof raw.design_url === "string" ? raw.design_url : undefined,
  };
};

export const mergeVisualizationSettingsIntoOrgSettings = (
  existing: unknown,
  visualization: VisualizationSettings
): Record<string, unknown> => {
  const base = isRecord(existing) ? { ...existing } : {};
  const oldVisualization = isRecord(base.visualization) ? base.visualization : {};
  return {
    ...base,
    visualization: {
      ...oldVisualization,
      ...visualization,
    },
  };
};

export const applyVisualizationSettings = (
  settings: VisualizationSettings
): (() => void) => {
  const root = document.documentElement;

  const vars: Array<keyof VisualizationSettings> = [
    "primary_color",
    "accent_color",
    "background_color",
    "card_color",
  ];

  const prevValues: Record<string, string> = {};
  const cssVarMap: Record<string, string> = {
    primary_color: "--primary",
    accent_color: "--accent",
    background_color: "--background",
    card_color: "--card",
  };

  vars.forEach((key) => {
    const cssVar = cssVarMap[key];
    prevValues[cssVar] = root.style.getPropertyValue(cssVar);
    const raw = settings[key];
    if (typeof raw === "string") {
      const normalized = normalizeHex(raw);
      if (normalized) {
        root.style.setProperty(cssVar, hexToHslChannels(normalized));
        if (key === "primary_color") {
          root.style.setProperty("--ring", hexToHslChannels(normalized));
        }
      }
    }
  });

  const faviconEl = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  const prevFavicon = faviconEl?.getAttribute("href") ?? null;
  if (faviconEl && settings.favicon_url && settings.favicon_url.trim()) {
    faviconEl.setAttribute("href", settings.favicon_url.trim());
  }

  return () => {
    Object.entries(prevValues).forEach(([k, v]) => {
      if (v) root.style.setProperty(k, v);
      else root.style.removeProperty(k);
    });

    if (faviconEl) {
      if (prevFavicon) faviconEl.setAttribute("href", prevFavicon);
      else faviconEl.removeAttribute("href");
    }
  };
};

export const applyOrganizationVisualizationSettings = async (
  settings: VisualizationSettings
): Promise<(() => void)> => {
  const cleanups: Array<() => void> = [];

  try {
    if (settings.design_url?.trim()) {
      const remoteCleanup = await loadAndApplyDesignThemeFromUrl(settings.design_url);
      cleanups.push(remoteCleanup);
    }
  } catch (error) {
    console.warn("Failed to load organization design theme", error);
  }

  cleanups.push(applyVisualizationSettings(settings));

  return () => {
    [...cleanups].reverse().forEach((cleanup) => cleanup());
  };
};
