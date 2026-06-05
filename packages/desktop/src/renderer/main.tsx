import { createRoot } from "react-dom/client";
import "./theme.css";
import { ConnectionGate } from "./ConnectionGate.js";
import { AppShell } from "./AppShell.js";

export function App() {
  return (
    <ConnectionGate>
      <AppShell />
    </ConnectionGate>
  );
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<App />);
}
