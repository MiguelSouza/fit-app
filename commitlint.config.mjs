/**
 * Conventional Commits, as CLAUDE.md requires ("Convenções").
 *
 * The scope is deliberately free: the repository uses both the name of a domain
 * module (`feat(nutrition): ...`) and the name of an infrastructure area
 * (`chore(repo): ...`). Pinning a list of scopes here would mean editing this
 * file for every new folder without catching a single real mistake.
 *
 * @type {import('@commitlint/types').UserConfig}
 */
const config = {
  extends: ['@commitlint/config-conventional'],
};

export default config;
