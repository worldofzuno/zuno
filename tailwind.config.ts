import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        black: "#000000",
        gold: {
          DEFAULT: "#F8D99B",
          dim: "#C9AE7C",
        },
        green: {
          DEFAULT: "#1E3932",
          dark: "#152A25",
        },
        beige: {
          DEFAULT: "#EDE4D3",
          dim: "#D8CCB4",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "serif"],
        sans: ["var(--font-sans)", "sans-serif"],
      },
      maxWidth: {
        content: "1440px",
      },
      transitionTimingFunction: {
        premium: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
