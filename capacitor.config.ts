import type { CapacitorConfig } from "@capacitor/cli";

// Suite convention: com.aerkatech.<app> — flat org root, one lowercase
// single-word segment per app. Permanent after first Play upload.
// JunkGenius is the merged flagship (ScrapScout + CashScan united, v4.1
// Mirrored Chrome / Deep Emerald Glass design) — replaces both standalone apps.
const config: CapacitorConfig = {
  appId: "com.aerkatech.junkgenius",
  appName: "JunkGenius",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
