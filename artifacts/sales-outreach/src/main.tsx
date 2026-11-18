import { createRoot } from "react-dom/client";
import { LocalAuthProvider } from "@/lib/local-auth";
import App from "./App";

import "./index.css";

createRoot(document.getElementById("root")!).render(
  <LocalAuthProvider>
    <App />
  </LocalAuthProvider>
);
