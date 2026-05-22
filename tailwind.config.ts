import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#16201a",
        field: "#f6f3ec",
        pine: "#164437",
        coral: "#d85d4a",
        gold: "#c88a2d",
        sky: "#3d7d94"
      },
      boxShadow: {
        panel: "0 18px 50px rgba(22, 32, 26, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
