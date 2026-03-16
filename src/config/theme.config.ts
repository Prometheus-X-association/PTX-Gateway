// Theme Configuration File
// Developers can adjust colors, fonts, and sizes for specific UI elements

export interface ThemeConfig {
  header: {
    badge: {
      background: string;
      borderColor: string;
      textColor: string;
      iconColor: string;
      fontSize: string;
      padding: string;
      borderRadius: string;
    };
    title: {
      fontSize: string;
      fontSizeMobile: string;
      fontWeight: string;
      textColor: string;
      gradientFrom: string;
      gradientTo: string;
    };
    subtitle: {
      fontSize: string;
      textColor: string;
      maxWidth: string;
    };
  };
  pages: {
    analyticsSelection: {
      title: {
        fontSize: string;
        fontWeight: string;
        textColor: string;
      };
      subtitle: {
        fontSize: string;
        textColor: string;
      };
      card: {
        background: string;
        borderColor: string;
        borderColorHover: string;
        borderColorSelected: string;
        backgroundSelected: string;
        iconColor: string;
        iconColorSelected: string;
        titleColor: string;
        descriptionColor: string;
        padding: string;
        borderRadius: string;
      };
    };
    dataSelection: {
      title: {
        fontSize: string;
        fontWeight: string;
        textColor: string;
      };
      uploadZone: {
        background: string;
        borderColor: string;
        borderColorHover: string;
        iconColor: string;
        textColor: string;
        subtextColor: string;
        padding: string;
        borderRadius: string;
      };
      apiSection: {
        labelColor: string;
        inputBackground: string;
        inputBorderColor: string;
        tagBackground: string;
        tagTextColor: string;
      };
    };
    processing: {
      title: {
        fontSize: string;
        fontWeight: string;
        textColor: string;
      };
      progressBar: {
        background: string;
        fillGradientFrom: string;
        fillGradientTo: string;
        height: string;
        borderRadius: string;
      };
      statusText: {
        fontSize: string;
        textColor: string;
      };
      stageCard: {
        background: string;
        borderColor: string;
        iconColorActive: string;
        iconColorComplete: string;
        iconColorPending: string;
        textColor: string;
      };
    };
    results: {
      title: {
        fontSize: string;
        fontWeight: string;
        textColor: string;
      };
      tabs: {
        background: string;
        activeBackground: string;
        textColor: string;
        activeTextColor: string;
        borderRadius: string;
      };
      jsonView: {
        keyColor: string;
        stringColor: string;
        numberColor: string;
        booleanColor: string;
        nullColor: string;
        bracketColor: string;
        background: string;
        fontFamily: string;
        fontSize: string;
      };
      tableView: {
        headerBackground: string;
        headerTextColor: string;
        cellBackground: string;
        cellTextColor: string;
        borderColor: string;
        alternateRowBackground: string;
      };
      exportButton: {
        background: string;
        borderColor: string;
        borderColorHover: string;
        textColor: string;
        iconColor: string;
      };
    };
  };
  stepIndicator: {
    size: string;
    fontSize: string;
    fontWeight: string;
    activeBackground: string;
    activeTextColor: string;
    completedBackground: string;
    completedTextColor: string;
    completedBorderColor: string;
    pendingBackground: string;
    pendingTextColor: string;
    connectorColor: string;
    connectorActiveColor: string;
  };
  global: {
    fontFamily: {
      sans: string;
      mono: string;
    };
    borderRadius: {
      sm: string;
      md: string;
      lg: string;
      xl: string;
    };
    spacing: {
      xs: string;
      sm: string;
      md: string;
      lg: string;
      xl: string;
    };
  };
}

const themeConfig: ThemeConfig = {
  header: {
    badge: {
      background: "hsl(var(--primary) / 0.1)",
      borderColor: "hsl(var(--primary) / 0.2)",
      textColor: "hsl(var(--primary))",
      iconColor: "hsl(var(--primary))",
      fontSize: "0.875rem",
      padding: "0.5rem 1rem",
      borderRadius: "9999px",
    },
    title: {
      fontSize: "3rem",
      fontSizeMobile: "2.25rem",
      fontWeight: "700",
      textColor: "hsl(var(--foreground))",
      gradientFrom: "hsl(187 85% 53%)",
      gradientTo: "hsl(200 85% 45%)",
    },
    subtitle: {
      fontSize: "1.125rem",
      textColor: "hsl(var(--muted-foreground))",
      maxWidth: "42rem",
    },
  },
  pages: {
    analyticsSelection: {
      title: {
        fontSize: "1.5rem",
        fontWeight: "600",
        textColor: "hsl(var(--foreground))",
      },
      subtitle: {
        fontSize: "0.875rem",
        textColor: "hsl(var(--muted-foreground))",
      },
      card: {
        background: "hsl(var(--card) / 0.8)",
        borderColor: "hsl(var(--border) / 0.5)",
        borderColorHover: "hsl(var(--primary) / 0.5)",
        borderColorSelected: "hsl(var(--primary))",
        backgroundSelected: "hsl(var(--primary) / 0.1)",
        iconColor: "hsl(var(--primary))",
        iconColorSelected: "hsl(var(--primary))",
        titleColor: "hsl(var(--foreground))",
        descriptionColor: "hsl(var(--muted-foreground))",
        padding: "1.5rem",
        borderRadius: "0.75rem",
      },
    },
    dataSelection: {
      title: {
        fontSize: "1.5rem",
        fontWeight: "600",
        textColor: "hsl(var(--foreground))",
      },
      uploadZone: {
        background: "hsl(var(--card) / 0.8)",
        borderColor: "hsl(var(--border) / 0.5)",
        borderColorHover: "hsl(var(--primary) / 0.5)",
        iconColor: "hsl(var(--muted-foreground))",
        textColor: "hsl(var(--foreground))",
        subtextColor: "hsl(var(--muted-foreground))",
        padding: "2rem",
        borderRadius: "0.75rem",
      },
      apiSection: {
        labelColor: "hsl(var(--foreground))",
        inputBackground: "hsl(var(--background))",
        inputBorderColor: "hsl(var(--input))",
        tagBackground: "hsl(var(--secondary))",
        tagTextColor: "hsl(var(--secondary-foreground))",
      },
    },
    processing: {
      title: {
        fontSize: "1.5rem",
        fontWeight: "600",
        textColor: "hsl(var(--foreground))",
      },
      progressBar: {
        background: "hsl(var(--muted))",
        fillGradientFrom: "hsl(var(--primary))",
        fillGradientTo: "hsl(var(--accent))",
        height: "0.5rem",
        borderRadius: "9999px",
      },
      statusText: {
        fontSize: "0.875rem",
        textColor: "hsl(var(--muted-foreground))",
      },
      stageCard: {
        background: "hsl(var(--muted))",
        borderColor: "hsl(var(--border))",
        iconColorActive: "hsl(var(--primary))",
        iconColorComplete: "hsl(142 76% 36%)",
        iconColorPending: "hsl(var(--muted-foreground))",
        textColor: "hsl(var(--foreground))",
      },
    },
    results: {
      title: {
        fontSize: "1.5rem",
        fontWeight: "600",
        textColor: "hsl(var(--foreground))",
      },
      tabs: {
        background: "hsl(var(--muted))",
        activeBackground: "hsl(var(--background))",
        textColor: "hsl(var(--muted-foreground))",
        activeTextColor: "hsl(var(--foreground))",
        borderRadius: "0.5rem",
      },
      jsonView: {
        keyColor: "hsl(187 85% 53%)",
        stringColor: "hsl(142 76% 46%)",
        numberColor: "hsl(45 93% 47%)",
        booleanColor: "hsl(280 65% 60%)",
        nullColor: "hsl(var(--muted-foreground))",
        bracketColor: "hsl(var(--muted-foreground))",
        background: "hsl(var(--muted))",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "0.875rem",
      },
      tableView: {
        headerBackground: "hsl(var(--muted))",
        headerTextColor: "hsl(var(--foreground))",
        cellBackground: "hsl(var(--background))",
        cellTextColor: "hsl(var(--foreground))",
        borderColor: "hsl(var(--border))",
        alternateRowBackground: "hsl(var(--muted) / 0.5)",
      },
      exportButton: {
        background: "hsl(var(--card) / 0.8)",
        borderColor: "hsl(var(--border) / 0.5)",
        borderColorHover: "hsl(var(--primary) / 0.5)",
        textColor: "hsl(var(--foreground))",
        iconColor: "hsl(var(--primary))",
      },
    },
  },
  stepIndicator: {
    size: "2.5rem",
    fontSize: "0.875rem",
    fontWeight: "500",
    activeBackground: "hsl(var(--primary))",
    activeTextColor: "hsl(var(--primary-foreground))",
    completedBackground: "hsl(var(--primary) / 0.2)",
    completedTextColor: "hsl(var(--primary))",
    completedBorderColor: "hsl(var(--primary) / 0.5)",
    pendingBackground: "hsl(var(--muted))",
    pendingTextColor: "hsl(var(--muted-foreground))",
    connectorColor: "hsl(var(--border))",
    connectorActiveColor: "hsl(var(--primary) / 0.5)",
  },
  global: {
    fontFamily: {
      sans: "'Inter', system-ui, sans-serif",
      mono: "'JetBrains Mono', monospace",
    },
    borderRadius: {
      sm: "0.25rem",
      md: "0.5rem",
      lg: "0.75rem",
      xl: "1rem",
    },
    spacing: {
      xs: "0.25rem",
      sm: "0.5rem",
      md: "1rem",
      lg: "1.5rem",
      xl: "2rem",
    },
  },
};

export default themeConfig;
