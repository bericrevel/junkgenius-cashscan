/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // JunkGenius identity v4 — Mirrored Chrome / Anodized Green (approved).
        // One material (chrome) + one signature color (anodized green) that
        // does double duty as "premium finish" and "money." Money values
        // always render in --a-bright, flat, monospace — never gradiented.
        ink: "#0A0D0C",
        ink2: "#0E1210",
        glass: "rgba(255,255,255,.045)",
        gbrd: "rgba(255,255,255,.12)",
        mist: "#B9C4BE",
        faint: "#7C8983",
        ghost: "#4B5652",
        // chrome — the metal
        chi: "#F4F8F8",   // highlight
        cmid: "#AAB6B8",  // mid steel
        clo: "#4A5254",   // shadow steel
        cblack: "#14181A",
        // deep emerald glass — darker, translucent, jewel-toned (not opaque
        // mint). Chrome bezels frame this like a watch case around a smoked
        // emerald crystal. aglow/abright stay bright ENOUGH for money text to
        // read clearly on the dark panel; amid/adeep/adeepest are for the
        // glassy translucent surface fills (buttons, rings, bezel faces).
        aglow: "#34D399",
        abright: "#10B981",
        amid: "#059669",
        adeep: "#047857",
        adeeper: "#065F46",
        adeepest: "#022C22",
        rose: "#FB7185",
      },
      fontFamily: {
        disp: ["'Space Grotesk'", "sans-serif"],
        sans: ["'Inter'", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
    },
  },
  plugins: [],
};
