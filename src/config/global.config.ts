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
      providers: Array<{
        id: string;
        name: string;
        apiBaseUrl: string;
        apiKey: string;
        model: string;
        enabled: boolean;
      }>;
      insightSystemPrompt: string;
      chatSystemPrompt: string;
      mcpServers: Array<{
        id: string;
        name: string;
        url: string;
        apiKey: string;
        enabled: boolean;
      }>;
      predefinedPrompts: string[];
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
      providers: [],
      insightSystemPrompt:
        "Analyze the JSON data and generate practical insights for business users. Return JSON only with keys: summary, insights (array of strings), visualization (object with type, title, xKey, yKey, categoryKey, valueKey, and data array).",
      chatSystemPrompt:
        "You are a data analyst assistant. The user is viewing a result dataset provided in the system context. Answer questions about it clearly and concisely. When asked for a chart or visualization, return a self-contained HTML snippet using Apache ECharts from CDN.",
      mcpServers: [],
      predefinedPrompts: [
        "Summarize the key findings in 3 bullet points",
        "Which item has the highest value and why might that be?",
        "Show me a bar chart of the top 10 results",
        "Are there any outliers or anomalies in this data?",
        "What trends do you see?",
        "Group these results by category and visualize it",
      ],
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
