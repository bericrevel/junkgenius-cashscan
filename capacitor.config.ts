import type { CapacitorConfig } from "@capacitor/cli";

// appId LOCKED (decision, July 2026): com.aerkatech.cashscan
// Suite convention: flat org root — com.aerkatech.<app>, one lowercase
// single-word segment per app, never a rebrandable family name. The display
// name ("JunkGenius CashScan") carries the branding; only the ID is permanent.
const config: CapacitorConfig = {
  appId: "com.aerkatech.cashscan",
  appName: "JunkGenius CashScan",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
