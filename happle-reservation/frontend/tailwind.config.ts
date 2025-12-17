import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#fef7ed',
          100: '#fdecd4',
          200: '#fad5a8',
          300: '#f6b871',
          400: '#f19038',
          500: '#ed7412',
          600: '#de5a08',
          700: '#b84209',
          800: '#93350f',
          900: '#772d0f',
          950: '#401405',
        },
        accent: {
          50: '#f5f7fa',
          100: '#eaeef4',
          200: '#d0dbe7',
          300: '#a7bdd2',
          400: '#7899b9',
          500: '#577da1',
          600: '#446486',
          700: '#38516d',
          800: '#31455b',
          900: '#2c3c4e',
          950: '#1d2734',
        },
      },
      fontFamily: {
        sans: ['var(--font-noto-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-zen-maru)', 'serif'],
      },
    },
  },
  plugins: [],
}
export default config



