export default {
  plugins: {
    tailwindcss: {
      content: ['./src/{renderer,web/client}/**/*.{html,ts,tsx}']
    },
    autoprefixer: {}
  }
}
