import themeConfig, { ThemeConfig } from "@/config/theme.config";

// Hook to access theme configuration
export const useTheme = (): ThemeConfig => {
  return themeConfig;
};

// Helper to get nested theme values with dot notation
export const getThemeValue = (path: string): string => {
  const keys = path.split(".");
  let value: unknown = themeConfig;
  
  for (const key of keys) {
    if (value && typeof value === "object" && key in value) {
      value = (value as Record<string, unknown>)[key];
    } else {
      console.warn(`Theme path not found: ${path}`);
      return "";
    }
  }
  
  return typeof value === "string" ? value : "";
};

// Helper to create inline styles from theme config section
export const createStyles = (themeSection: Record<string, string>): React.CSSProperties => {
  const styleMap: Record<string, string> = {
    background: "backgroundColor",
    textColor: "color",
    borderColor: "borderColor",
    fontSize: "fontSize",
    fontWeight: "fontWeight",
    padding: "padding",
    borderRadius: "borderRadius",
    maxWidth: "maxWidth",
    fontFamily: "fontFamily",
  };

  const styles: React.CSSProperties = {};
  
  for (const [key, value] of Object.entries(themeSection)) {
    const cssProperty = styleMap[key];
    if (cssProperty && typeof value === "string") {
      (styles as Record<string, string>)[cssProperty] = value;
    }
  }
  
  return styles;
};

export default useTheme;
