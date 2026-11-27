import { Inject, Injectable } from '@nestjs/common';

import { LoadPatientCaller } from '../../identity';
import { EVENT_BUS, type EventBusPort } from '../../../shared/events/event-bus.port';
import {
  assertCheckinWindowIsOpen,
  checkinToRecord,
  wasCorrected,
  type CheckinAnswers,
  type RecordedCheckin,
} from '../domain/checkin';
import { CHECKIN_REPOSITORY, type CheckinRepository } from './ports/checkin-repository.port';

/**
 * The patient saves the check-in of a day — or corrects the one they already
 * saved (card P-02).
 *
 * **Authorization.** Only the patient themselves, resolved from the `sub` of
 * the verified token (ADR 0007) through `identity`'s own caller service, which
 * is the one place that line is written (CLAUDE.md, "Saúde e LGPD"). There is
 * no patient id in the request and no "on behalf of": a professional cannot
 * fill in somebody's day, and a platform where they could would be recording
 * the nutritionist's guess as the patient's answer.
 *
 * **One check-in per day, and the database is what makes it so.** The day is
 * in the path, the write is an upsert on (patient, day), and sending the same
 * request twice saves one check-in — the card's "atualiza, não duplica".
 *
 * **Editable on its own day and no longer.** The window is the day itself in
 * the patient's time zone, which is why this use case reads the zone off their
 * profile and never the server's (`assertCheckinWindowIsOpen`). Yesterday
 * answers 422.
 *
 * **Nothing is logged.** How much energy somebody had, how they slept and what
 * their gut did are health data; the ids and the day are what the event
 * carries, and even that is a code and a date (CLAUDE.md, "Saúde e LGPD").
 *
 * **It writes no access record.** The access log answers "quem viu os meus
 * dados", and this is the patient writing their own — `accessToLog` refuses a
 * row where the actor is the patient, on purpose (card I-06).
 */
@Injectable()
export class RecordCheckinUseCase {
  constructor(
    private readonly callers: LoadPatientCaller,
    @Inject(CHECKIN_REPOSITORY) private readonly checkins: CheckinRepository,
    @Inject(EVENT_BUS) private readonly events: EventBusPort,
  ) {}

  /**
   * @param authUserId the `sub` of the verified access token
   * @param date the day of the check-in, `YYYY-MM-DD`, as it came off the path
   * @param answers what the patient tapped and typed
   * @returns the check-in as it stands afterwards
   * @throws ProfileNotFoundError when the caller has no profile (404),
   *   CallerIsNotPatientError when the account is a professional's (403)
   * @throws InvalidCheckinDateError when the day is not a day (400)
   * @throws CheckinWindowClosedError when the day is not the patient's today
   *   (422)
   */
  async execute(
    authUserId: string,
    date: string,
    answers: CheckinAnswers,
  ): Promise<RecordedCheckin> {
    // One instant for the whole request: the day the window is measured
    // against and the instant stamped on the row have to be the same reading
    // of the clock, or a save at midnight could be refused for a day it was
    // then recorded under.
    const savedAt = new Date();

    const caller = await this.callers.execute(authUserId);
    const toRecord = checkinToRecord(caller.profileId, date, answers, savedAt);

    assertCheckinWindowIsOpen(toRecord.date, caller.timeZone, savedAt);

    const saved = await this.checkins.save(toRecord);

    // Announced after the write and never before: the fact is that a check-in
    // was recorded, and a subscriber that reacted to one the database then
    // refused would be reacting to nothing (CLAUDE.md rule 3). A handler that
    // fails is a log line and does not undo the save (ADR 0009).
    await this.events.publish('health.checkin.recorded', {
      patientId: caller.profileId,
      date: saved.date,
      corrected: wasCorrected(saved, savedAt),
      savedAt: savedAt.toISOString(),
    });

    return saved;
  }
}
