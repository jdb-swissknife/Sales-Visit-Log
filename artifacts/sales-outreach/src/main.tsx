import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import App from "./App";
import { clerkAppearance } from "@/lib/clerk-appearance";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <ClerkProvider
    publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}
    appearance={clerkAppearance}
  >
    <App />
  </ClerkProvider>
);
