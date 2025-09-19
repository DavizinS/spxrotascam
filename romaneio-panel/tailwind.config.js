/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}", // se existir
  ],
  theme: {
    extend: {
      borderRadius: { '2xl': '1rem' },
      boxShadow: { card: '0 4px 20px rgba(0,0,0,0.06)' },
    },
  },
  plugins: [],
};
