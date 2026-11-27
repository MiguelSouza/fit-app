import { InvalidInputError, RuleViolationError } from '../../../shared/domain/domain-error';

/**
 * What `health` refuses, as domain errors. The translation to a status code
 * happens in `shared/presentation/global-exception.filter.ts` and nowhere else
 * (CLAUDE.md, "Convenções").
 *
 * The `code` is what a client keys its i18n off, so it is stable; the message
 * is pt-BR, ready to show, and carries no personal data and no value of a
 * check-in — it travels in the response and the client may log it.
 *
 * What is **not** in this file is a refusal about who may read a patient:
 * every one of those is `identity`'s, answered by its access service and its
 * own errors (ADR 0017), so that a patient a professional may not see answers
 * exactly like a patient that does not exist.
 */

/**
 * The text in the path is not a day of the calendar: wrong shape, or digits
 * that name no day (`2026-02-31`).
 *
 * 400: it is the one failure here that is about the request and not about a
 * rule. It is answered for `{date}` and for both ends of a period.
 */
export class InvalidCheckinDateError extends InvalidInputError {
  constructor() {
    super('health.checkin.invalid_date', 'Data inválida. Use um dia do calendário, YYYY-MM-DD.');
  }
}

/**
 * The day is not the patient's today, so the check-in of that day can no
 * longer be written (card P-02: "um por dia, editável no mesmo dia").
 *
 * **422 and not 404.** Nothing was looked up and nothing is being hidden: the
 * request is well formed, the day exists, and a product rule is what refuses
 * it. A 404 would tell the app the endpoint is wrong, when what is wrong is
 * the day.
 *
 * The message says what the window is, because that is the one thing the
 * person on the other side can act on — and it says nothing about whether a
 * check-in for that day already exists, which is nobody's business but the
 * patient's and is not what was asked.
 */
export class CheckinWindowClosedError extends RuleViolationError {
  constructor() {
    super(
      'health.checkin.window_closed',
      'O check-in é preenchido e corrigido no próprio dia. Esse dia já passou — conte o ' +
        'que precisar na nota do check-in de hoje.',
    );
  }
}

/** The first day of the period is after the last one. */
export class InvalidCheckinPeriodError extends InvalidInputError {
  constructor() {
    super(
      'health.checkin.invalid_period',
      'Período inválido: o primeiro dia não pode ser depois do último.',
    );
  }
}

/**
 * The period asked for more days than one request answers.
 *
 * Refused and not quietly shortened: a client that asked for five years and
 * got one would draw a chart that is wrong and says nothing about it.
 *
 * The ceiling arrives as an argument instead of being read from `checkin.ts`,
 * where it is declared: this file is imported by that one, and importing it
 * back would be a cycle between two modules of the same layer — the kind that
 * works until the day the constant is read while the first one is still being
 * evaluated.
 */
export class CheckinPeriodTooLongError extends InvalidInputError {
  /** @param maxDays how many days one request may ask for */
  constructor(maxDays: number) {
    super(
      'health.checkin.period_too_long',
      `Período muito longo. Peça no máximo ${maxDays} dias de uma vez.`,
    );
  }
}
