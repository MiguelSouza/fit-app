import {
  type Checkin as CheckinDto,
  type CheckinList as CheckinListDto,
  type CheckinSymptom as CheckinSymptomDto,
} from '@fit-app/contracts';

import {
  type CheckinsInPeriod,
  type CheckinSymptom,
  type RecordedCheckin,
} from '../domain/checkin';

/**
 * The check-in as the contract answers it (card P-02).
 *
 * Three things happen here and nowhere else. The instants become ISO 8601 text
 * in UTC, which is what every client parses (CLAUDE.md, "Dados de saúde") —
 * while the **day** stays text, because it is a day and not an instant. The two
 * vocabularies are checked against each other: the domain declares its own
 * symptoms, and the assignment below only compiles while the contract still
 * has every value the domain can produce. And `null` becomes absent — a note
 * nobody wrote is a field the answer does not carry, not a `null` every client
 * has to handle.
 *
 * The same answer goes to the patient who wrote the check-in and to the
 * professional who follows them: there is nothing added for one and nothing
 * hidden from the other, and no score anywhere. Reading these values is
 * `insights`' job and arrives from `insights` (CLAUDE.md, "Saúde e LGPD":
 * linguagem de apoio, nunca de diagnóstico).
 */
export function toCheckinResponse(checkin: RecordedCheckin): CheckinDto {
  return {
    date: checkin.date,
    energy: checkin.energy,
    sleepQuality: checkin.sleepQuality,
    hunger: checkin.hunger,
    symptoms: checkin.symptoms.map(toCheckinSymptom),
    ...(checkin.otherSymptom === null ? {} : { otherSymptom: checkin.otherSymptom }),
    ...(checkin.note === null ? {} : { note: checkin.note }),
    recordedAt: checkin.recordedAt.toISOString(),
    updatedAt: checkin.updatedAt.toISOString(),
  };
}

/**
 * The listing: the period that was asked for, and the check-ins inside it.
 *
 * The period is answered back because a client drawing a fortnight has to know
 * which fortnight these rows are. The days with no check-in are not in the
 * list and nothing stands in for them.
 */
export function toCheckinListResponse(result: CheckinsInPeriod): CheckinListDto {
  return {
    from: result.period.from,
    to: result.period.to,
    checkins: result.checkins.map(toCheckinResponse),
  };
}

/** Where the domain's symptoms and the contract's are checked to be the same word. */
function toCheckinSymptom(symptom: CheckinSymptom): CheckinSymptomDto {
  return symptom;
}
