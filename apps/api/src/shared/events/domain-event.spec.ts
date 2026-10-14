import { DOMAIN_EVENT_NAMES } from './domain-event';

/**
 * The naming rule of CLAUDE.md rule 3 is a convention until something checks
 * it. This is the something: `<module>.<entity>.<fact in the past>`, lower
 * case, and a module that exists.
 */
const MODULES = ['identity', 'nutrition', 'health', 'insights'];

const NAME = /^[a-z]+(?:_[a-z]+)*\.[a-z]+(?:_[a-z]+)*\.[a-z]+(?:_[a-z]+)*$/;

describe('the catalogue of domain events', () => {
  it.each(DOMAIN_EVENT_NAMES)('names %s as <module>.<entity>.<fact>', (name) => {
    expect(name).toMatch(NAME);
  });

  it.each(DOMAIN_EVENT_NAMES)('publishes %s from a module that exists', (name) => {
    expect(MODULES).toContain(name.split('.')[0]);
  });

  it('has no duplicate', () => {
    expect(new Set(DOMAIN_EVENT_NAMES).size).toBe(DOMAIN_EVENT_NAMES.length);
  });
});
