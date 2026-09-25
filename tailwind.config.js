/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}", "./screens/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "#2c1b3d", 600: "#3a2552", 700: "#241534", 800: "#1c1029" },
        accent:  { DEFAULT: "#eab308", hover: "#ca9a06", soft: "#fef9c3" },
        surface: "#f3f4f6",
        success: "#10b981",
        danger:  "#ef4444",
        info:    "#3b82f6",
        teal:    "#14b8a6",
      },
      fontFamily: { tajawal: ["Tajawal", "sans-serif"] },
      boxShadow: {
        card: "0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.05)",
        pop:  "0 20px 45px -12px rgb(44 27 61 / 0.35)",
      },
      borderRadius: { xl2: "12px" },
    },
  },
  plugins: [],
};
