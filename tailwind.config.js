/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        sf: {
          blue: '#0176d3',
          'blue-dark': '#014486',
          'blue-light': '#1b96ff',
          navy: '#032d60',
          cloud: '#f3f2f2',
          teal: '#06a59a',
          purple: '#9050e9',
          orange: '#fe9339',
          red: '#ba0517',
          green: '#2e844a',
        }
      }
    }
  },
  plugins: []
}
