// Global Configuration
// Controls admin/debug mode and application-wide settings

const DATA_ANALYST_SYSTEM_PROMPT =
  "You are a data analyst assistant. The user is viewing a result dataset. Answer questions clearly and concisely with insights, trends, patterns, and actionable recommendations. Structure your response with headings and bullet points for clarity.";

const CHART_BUILDER_SYSTEM_PROMPT =
  "You are a data visualization expert. When asked for a chart, return ONLY a self-contained HTML block: a container div with id='chart' and style='height:400px', followed by a script tag loading ECharts from 'https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js', then an init script using document.getElementById('chart'). Output no text outside the HTML block.";

const AI_INSIGHT_SYSTEM_PROMPT =
  "You are a business intelligence expert. For the given data, provide: 1) A concise summary paragraph, 2) 3-5 key bullet point insights, 3) A self-contained ECharts HTML visualization at the end. The visualization must be a <div id='chart' style='height:400px'></div> followed by the ECharts CDN <script> tag and an init script that calls document.getElementById('chart').";

const SWITCHABLE_CHART_SYSTEM_PROMPT =
  "Analyze the JSON data and return JSON only. Required keys: summary (string), insights (string[]), visualization (object). Choose the best visualization type from: 'bar'|'line'|'area'|'scatter'|'pie'|'radial'|'treemap'|'network'|'map'. Provide the matching data structure: data[] for cartesian/pie/radial types, nodes[]+links[] for network, hierarchy object for treemap, data[] with lat/lng fields for map. Keep labels concise and aggregate long-tail items as 'Other'. The user can switch to another compatible chart type in the UI after generation.";

export interface LlmProviderConfig {
  id: string;
  name: string;
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
}

export interface LlmAgentConfig {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  expectedOutput: "text" | "json" | "html" | "mixed";
  outputInstructions: string;
  mcpServerIds: string[];
  mcpToolFilter: Record<string, string[]>;
  providerIds: string[];
  agentProviders: LlmProviderConfig[];
  defaultPrompts: string[];
  enabled: boolean;
}

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
      mcpServers: Array<{
        id: string;
        name: string;
        url: string;
        apiKey: string;
        enabled: boolean;
      }>;
      agents: LlmAgentConfig[];
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
      mcpServers: [],
      agents: [
        {
          id: "data-analyst",
          name: "Data Analyst",
          description: "General data analysis, insights, and trend identification",
          systemPrompt: DATA_ANALYST_SYSTEM_PROMPT,
          expectedOutput: "text",
          mcpServerIds: [], mcpToolFilter: {}, providerIds: [], agentProviders: [],
          defaultPrompts: [
            "Summarize the key findings in 3 bullet points",
            "Which item has the highest value and why might that be?",
            "Are there any outliers or anomalies in this data?",
            "What trends do you see?",
          ],
          enabled: true,
        },
        {
          id: "chart-builder",
          name: "Chart Builder",
          description: "Creates interactive ECharts visualizations from data",
          systemPrompt: CHART_BUILDER_SYSTEM_PROMPT,
          expectedOutput: "echarts",
          mcpServerIds: [], mcpToolFilter: {}, providerIds: [], agentProviders: [],
          defaultPrompts: [
            "Show me a bar chart of the top 10 results",
            "Create a pie chart of the data distribution",
            "Show a line chart of values over time",
            "Visualize the top 5 items as a horizontal bar chart",
          ],
          enabled: true,
        },
        {
          id: "ai-insight",
          name: "AI Insight",
          description: "Full analysis with written insights and a chart visualization",
          systemPrompt: AI_INSIGHT_SYSTEM_PROMPT,
          expectedOutput: "mixed",
          mcpServerIds: [], mcpToolFilter: {}, providerIds: [], agentProviders: [],
          defaultPrompts: [
            "Generate a complete AI insight with visualization for this data",
            "Give me a business summary with a supporting chart",
            "Analyze this data and show me the most important visualization",
          ],
          enabled: true,
        },
        {
          id: "switchable-chart",
          name: "Switchable Chart",
          description: "Returns structured JSON with summary, insights, and a chart spec the user can switch between types",
          systemPrompt: SWITCHABLE_CHART_SYSTEM_PROMPT,
          expectedOutput: "mixed",
          mcpServerIds: [], mcpToolFilter: {}, providerIds: [], agentProviders: [],
          defaultPrompts: [
            "Analyze this data and generate an interactive chart I can switch between types",
            "Generate a summary with insights and a switchable visualization",
            "What is the best chart type for this data? Show me the result",
          ],
          enabled: true,
        },
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
