import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initClientMonitoring } from "./lib/observability";

initClientMonitoring();

createRoot(document.getElementById("root")!).render(<App />);
