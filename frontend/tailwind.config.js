/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
  theme: {
    extend: {
      fontFamily: {
        heading: ["'Plus Jakarta Sans'", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["'Manrope'", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        // Lapakin brand
        brand: {
          DEFAULT: "#C04A3B",
          hover: "#A63E31",
          accent: "#F2A65A",
          moss: "#2D5A27",
          sand: "#FDFBF7",
          off: "#F5F2EA",
          ink: "#2B2624",
          mute: "#7A736E",
          line: "#EBE7E0",
        },
      },
      boxShadow: {
        card: "0 8px 30px rgb(192 74 59 / 0.04)",
        cardHover: "0 20px 40px rgb(192 74 59 / 0.10)",
        glass: "0 8px 32px rgba(0,0,0,0.04)",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
        "fade-up": { "0%": { opacity: "0", transform: "translateY(12px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        "blob": { "0%,100%": { transform: "translate(0,0) scale(1)" }, "50%": { transform: "translate(20px,-30px) scale(1.05)" } },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-up": "fade-up 0.5s ease-out both",
        "blob": "blob 18s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
