import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  future: {
    // Compiles hover: to @media (hover: hover) and (pointer: fine) so taps on
    // touch devices don't leave elements stuck in a hover state.
    hoverOnlyWhenSupported: true,
  },
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
        // Strong ease-out for entrances, exits and press feedback.
        premium: "cubic-bezier(0.16, 1, 0.3, 1)",
        // Strong ease-in-out for elements moving between two on-screen positions.
        move: "cubic-bezier(0.77, 0, 0.175, 1)",
        // iOS-like curve for panels that slide in from an edge.
        drawer: "cubic-bezier(0.32, 0.72, 0, 1)",
      },
      transitionDuration: {
        press: "140ms",
        control: "200ms",
        panel: "260ms",
      },
    },
  },
  plugins: [],
};

export default config;
