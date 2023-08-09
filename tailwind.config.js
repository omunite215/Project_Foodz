/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    
    extend: {
      colors: {
        bgWhite: "#FCFCFD",
        primaryGreen: "#04B90B",
        textBlack: "#23262F",
        textNeutralBlack: "#777E90",
        paraTextColor: "#353945",
        bgGreen: "#DDF3D8",
        neutralWhite: "#F4F5F6",
        neutralLineWhite: "#E6E8EC"
      },
      fontFamily: {
        poppins: ['Poppins', 'sans-serif'],
        alice: ['Alice', 'serif']
      },
      screens: {
      xs: "480px",
      ss: "620px",
      sm: "768px",
      md: "1060px",
      lg: "1200px",
      xl: "1700px",
    },
    },
  },
  plugins: [],
}
