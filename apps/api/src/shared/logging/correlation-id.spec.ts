import {
  currentCorrelationId,
  newCorrelationId,
  readCorrelationId,
  runWithCorrelationId,
} from './correlation-id';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('readCorrelationId', () => {
  it('keeps the id the caller sent, so a trace survives the hop', () => {
    expect(readCorrelationId('panel-4f2b9c71')).toBe('panel-4f2b9c71');
  });

  it('generates one when the caller sent nothing', () => {
    expect(readCorrelationId(undefined)).toMatch(UUID);
  });

  it('ignores an id that is too short, too long or not plain text', () => {
    // The value is repeated in every line of the request: it is replaced, not
    // cleaned up.
    for (const raw of ['short', 'a'.repeat(65), 'has space', 'quote"inside', '\u001b[31mred', 42]) {
      expect(readCorrelationId(raw)).toMatch(UUID);
    }
  });

  it('takes the first value when the header came more than once', () => {
    expect(readCorrelationId(['panel-4f2b9c71', 'another-one'])).toBe('panel-4f2b9c71');
  });
});

describe('runWithCorrelationId', () => {
  it('keeps the id across an await', async () => {
    await runWithCorrelationId('trace-abc-123', async () => {
      await Promise.resolve();

      expect(currentCorrelationId()).toBe('trace-abc-123');
    });
  });

  it('has no id outside a request, which is how a job logs', () => {
    expect(currentCorrelationId()).toBeUndefined();
  });

  it('gives a different id every time', () => {
    expect(newCorrelationId()).not.toBe(newCorrelationId());
  });
});
