/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './client/index.html',
    './client/src/**/*.{js,jsx}'
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace']
      }
    }
  },
  plugins: []
};
