/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        dadam: {
          white: '#FAFAFA',
          cream: '#F8F7F4',
          warm: '#EBE8E2',
          gray: '#8B8680',
          charcoal: '#2D2A26',
          black: '#1A1918',
          gold: '#B8956C',
        },
      },
      fontFamily: {
        serif: ['Playfair Display', 'Noto Serif KR', 'serif'],
        sans: ['Pretendard', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
