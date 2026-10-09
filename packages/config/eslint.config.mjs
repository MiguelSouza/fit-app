// The package lints itself with the config it exports: if the base breaks,
// `pnpm lint` breaks here first.
export { default } from './eslint/base.js';
