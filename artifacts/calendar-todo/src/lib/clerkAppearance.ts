import { shadcn } from "@clerk/themes";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Branded Clerk appearance matching Goal Tracker's warm, serif, terracotta theme. */
export const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
    socialButtonsPlacement: "top" as const,
    socialButtonsVariant: "blockButton" as const,
  },
  variables: {
    colorPrimary: "hsl(25, 80%, 45%)",
    colorForeground: "hsl(20, 15%, 15%)",
    colorMutedForeground: "hsl(25, 10%, 45%)",
    colorDanger: "hsl(0, 70%, 50%)",
    colorBackground: "hsl(40, 33%, 99%)",
    colorInput: "hsl(0, 0%, 100%)",
    colorInputForeground: "hsl(20, 15%, 15%)",
    colorNeutral: "hsl(30, 15%, 88%)",
    fontFamily: "'Geist', 'Inter', sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-card border border-border shadow-lg rounded-2xl w-[440px] max-w-full overflow-hidden",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "font-serif text-2xl text-foreground",
    headerSubtitle: "text-muted-foreground",
    socialButtonsBlockButton: "border border-border text-foreground hover:bg-accent",
    socialButtonsBlockButtonText: "text-foreground font-medium",
    dividerLine: "bg-border",
    dividerText: "text-muted-foreground",
    formFieldLabel: "text-foreground font-medium",
    formFieldInput: "bg-white border border-input text-foreground",
    formButtonPrimary: "bg-primary text-primary-foreground hover:bg-primary/90",
    footerActionText: "text-muted-foreground",
    footerActionLink: "text-primary hover:text-primary/80 font-medium",
    identityPreviewEditButton: "text-primary",
    formFieldSuccessText: "text-foreground",
    formFieldErrorText: "text-destructive",
    alertText: "text-foreground",
    otpCodeFieldInput: "border border-input text-foreground",
    logoBox: "h-10",
    logoImage: "h-10 w-auto",
  },
};

export const clerkLocalization = {
  signIn: {
    start: {
      title: "Welcome back",
      subtitle: "Sign in to reach your goals",
    },
  },
  signUp: {
    start: {
      title: "Create your account",
      subtitle: "Start tracking honest follow-through",
    },
  },
};
