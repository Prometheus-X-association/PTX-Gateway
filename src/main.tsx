import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { loadAndApplyStartupDesignTheme } from "@/utils/designTheme";

void loadAndApplyStartupDesignTheme();

createRoot(document.getElementById("root")!).render(<App />);
