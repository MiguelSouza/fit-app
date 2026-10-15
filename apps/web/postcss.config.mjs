/**
 * Tailwind CSS 4 is a PostCSS plugin and nothing else: there is no
 * `tailwind.config.js` any more. What used to be configuration — the colours,
 * the radii, the font stack — is CSS now, in the `@theme` block of
 * `src/app/globals.css`.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
