import { createRoot } from "react-dom/client";
import App from "./App";
import { initClientMonitoring } from "./lib/observability";
import "./index.css";

initClientMonitoring();

createRoot(document.getElementById("root")!).render(<App />);
