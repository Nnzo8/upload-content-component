/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f3fbeb',
          100: '#e3f6c9',
          200: '#c7ec93',
          300: '#a3dd58',
          400: '#7bc52d',
          500: '#60a81f',
          600: '#4b8618',
          700: '#3a6816',
          800: '#315315',
          900: '#2a4414'
        }
      },
      boxShadow: {
        modal: '0 18px 45px rgba(17, 24, 39, 0.22)'
      }
    }
  },
  plugins: []
};

