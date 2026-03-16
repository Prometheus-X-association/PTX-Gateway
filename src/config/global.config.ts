// Global Configuration
// Controls admin/debug mode and application-wide settings

export interface GlobalConfig {
  admin: {
    enabled: boolean;
    debugMode: boolean;
    showConfigPage: boolean;
    showHumanValidation: boolean;
  };
  app: {
    name: string;
    version: string;
    environment: "development" | "staging" | "production";
  };
  features: {
    enableFileUpload: boolean;
    enableApiConnections: boolean;
    enableTextInput: boolean;
    enableCustomApi: boolean;
    allowContinueOnPdcError: boolean;
    llmInsights: {
      enabled: boolean;
      provider: "openai" | "custom";
      apiBaseUrl: string;
      apiKey: string;
      model: string;
      promptTemplate: string;
    };
    maxFileSizeMB: number;
    maxFilesCount: number;
  };
  logging: {
    enabled: boolean;
    level: "debug" | "info" | "warn" | "error";
  };
}

export const globalConfig: GlobalConfig = {
  admin: {
    // Master switch for admin mode
    enabled: true,
    // When true, shows additional debug pages in the workflow
    debugMode: true,
    // When debugMode is true, shows config page before step 1
    showConfigPage: true,
    // When debugMode is true, shows human validation page between step 2 and 3
    showHumanValidation: true,
  },
  app: {
    name: "Data Analytics Platform",
    version: "1.0.0",
    environment: "development",
  },
  features: {
    enableFileUpload: true,
    enableApiConnections: true,
    enableTextInput: true,
    enableCustomApi: true,
    allowContinueOnPdcError: false,
    llmInsights: {
      enabled: false,
      provider: "openai",
      apiBaseUrl: "https://api.openai.com/v1",
      apiKey: "",
      model: "gpt-4o-mini",
      promptTemplate:
        "Analyze the JSON data and generate practical insights for business users. Return JSON only with keys: summary, insights (array of strings), visualization (object with type, title, xKey, yKey, categoryKey, valueKey, and data array).",
    },
    maxFileSizeMB: 50,
    maxFilesCount: 10,
  },
  logging: {
    enabled: true,
    level: "debug",
  },
};

// Helper function to check if debug mode is active
export const isDebugMode = (): boolean => {
  return globalConfig.admin.enabled && globalConfig.admin.debugMode;
};

// Helper function to check if config page should show
export const shouldShowConfigPage = (): boolean => {
  return isDebugMode() && globalConfig.admin.showConfigPage;
};

// Helper function to check if human validation should show
export const shouldShowHumanValidation = (): boolean => {
  return isDebugMode() && globalConfig.admin.showHumanValidation;
};

export default globalConfig;
