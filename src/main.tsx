import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { loadAndApplyStartupDesignTheme } from "@/utils/designTheme";

const rootElement = document.getElementById("root")!;

const bootstrap = async () => {
  await loadAndApplyStartupDesignTheme();
  createRoot(rootElement).render(<App />);
};

void bootstrap();
