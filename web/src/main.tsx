import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Router } from "./router";
import { ThemeProvider } from "./theme";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <Router>
        <App />
      </Router>
    </ThemeProvider>
  </StrictMode>,
);
