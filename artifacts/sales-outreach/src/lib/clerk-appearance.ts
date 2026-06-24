/**
 * Clerk appearance mapped to the app's CSS custom properties.
 * Automatically follows light/dark mode since the variables
 * change in .dark scope.
 */
export const clerkAppearance = {
  layout: {
    socialButtonsPlacement: "top",
    socialButtonsVariant: "blockButton",
    showOptionalFields: false,
    shimmer: true,
  },
  variables: {
    colorPrimary: "hsl(var(--primary))",
    colorPrimaryForeground: "hsl(var(--primary-foreground))",
    colorText: "hsl(var(--foreground))",
    colorTextSecondary: "hsl(var(--muted-foreground))",
    colorBackground: "hsl(var(--card))",
    colorForeground: "hsl(var(--card-foreground))",
    colorInputBackground: "transparent",
    colorInputText: "hsl(var(--foreground))",
    colorDanger: "hsl(var(--destructive))",
    colorSuccess: "hsl(142 65% 35%)",
    borderRadius: "var(--radius)",
    fontFamily: "var(--app-font-sans)",
    fontFamilyButtons: "var(--app-font-sans)",
    fontSize: "14px",
  },
  elements: {
    rootBox: {
      width: "100%",
    },
    card: {
      width: "380px",
      maxWidth: "100%",
      backgroundColor: "hsl(var(--card))",
      color: "hsl(var(--card-foreground))",
      border: "1px solid hsl(var(--border))",
      borderRadius: "calc(var(--radius) + 2px)",
      boxShadow: "var(--shadow-xl)",
    },
    headerTitle: {
      fontSize: "20px",
      fontWeight: "600",
      color: "hsl(var(--foreground))",
    },
    headerSubtitle: {
      color: "hsl(var(--muted-foreground))",
      fontSize: "14px",
    },
    socialButtonsBlockButton: {
      backgroundColor: "hsl(var(--secondary))",
      color: "hsl(var(--secondary-foreground))",
      border: "1px solid hsl(var(--border))",
      borderRadius: "var(--radius)",
      fontSize: "14px",
      fontWeight: "500",
      _hover: {
        backgroundColor: "hsl(var(--accent) / 0.1)",
      },
    },
    socialButtonsBlockButtonText: {
      color: "hsl(var(--secondary-foreground))",
    },
    dividerLine: {
      backgroundColor: "hsl(var(--border))",
    },
    dividerText: {
      color: "hsl(var(--muted-foreground))",
      fontSize: "12px",
    },
    formFieldLabel: {
      color: "hsl(var(--foreground))",
      fontSize: "13px",
      fontWeight: "500",
    },
    formFieldInput: {
      backgroundColor: "hsl(var(--background))",
      color: "hsl(var(--foreground))",
      border: "1px solid hsl(var(--input))",
      borderRadius: "var(--radius)",
      fontSize: "14px",
      _focus: {
        borderColor: "hsl(var(--primary))",
        boxShadow: "0 0 0 2px hsl(var(--primary) / 0.15)",
      },
    },
    formButtonPrimary: {
      backgroundColor: "hsl(var(--primary))",
      color: "hsl(var(--primary-foreground))",
      border: "1px solid hsl(var(--primary-border))",
      borderRadius: "var(--radius)",
      fontSize: "14px",
      fontWeight: "600",
      _hover: {
        backgroundColor: "hsl(var(--primary) / 0.9)",
      },
    },
    footerPageLink: {
      color: "hsl(var(--primary))",
      fontSize: "13px",
      fontWeight: "500",
    },
    identityPreview: {
      backgroundColor: "hsl(var(--muted))",
      borderRadius: "var(--radius)",
    },
    alertText: {
      color: "hsl(var(--destructive))",
    },
    formHeaderTitle: {
      fontSize: "20px",
      fontWeight: "600",
    },
    navbarButton: {
      color: "hsl(var(--foreground))",
    },
  },
} as const;
