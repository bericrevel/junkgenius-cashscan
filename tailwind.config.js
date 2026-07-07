/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // JunkGenius identity v4.2 — Mirrored Chrome / Deep Jewel Glass.
        // One material (chrome, constant) + one signature glass color that
        // the owner picks on the Home screen: emerald (default), sapphire,
        // or gold. The accent + ink tokens below read CSS variables defined
        // per-finish in src/index.css, so every text-abright / bg-ink2
        // usage follows the active finish automatically. Money values
        // always render in the bright accent, flat, monospace — never
        // gradiented.
        ink: "rgb(var(--ink) / <alpha-value>)",
        ink2: "rgb(var(--ink2) / <alpha-value>)",
        glass: "rgba(255,255,255,.045)",
        gbrd: "rgba(255,255,255,.12)",
        mist: "#B9C4BE",
        faint: "#7C8983",
        ghost: "#4B5652",
        // chrome — the metal (identical in every finish)
        chi: "#F4F8F8",   // highlight
        cmid: "#AAB6B8",  // mid steel
        clo: "#4A5254",   // shadow steel
        cblack: "#14181A",
        // jewel glass accent ramp — follows the active finish
        aglow: "rgb(var(--a-400) / <alpha-value>)",
        abright: "rgb(var(--a-500) / <alpha-value>)",
        amid: "rgb(var(--a-600) / <alpha-value>)",
        adeep: "rgb(var(--a-700) / <alpha-value>)",
        adeeper: "rgb(var(--a-800) / <alpha-value>)",
        adeepest: "rgb(var(--a-950) / <alpha-value>)",
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
