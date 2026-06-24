import { MapPin } from "lucide-react";

/**
 * Branded wrapper for Clerk sign-in / sign-up pages.
 * Matches the app's "Field Notebook" theme.
 */
export function AuthPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-8">
      {/* Brand header */}
      <div className="mb-6 flex flex-col items-center gap-2">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-md">
          <MapPin className="h-6 w-6" />
        </div>
        <div className="text-center">
          <h1 className="font-serif text-xl font-semibold text-primary">
            OutreachLog
          </h1>
          <p className="text-xs text-muted-foreground">
            Field sales outreach tracker
          </p>
        </div>
      </div>
      {/* Clerk component */}
      <div className="flex w-full justify-center">{children}</div>
    </div>
  );
}
