import {
  type AccessLogAction as AccessLogActionDto,
  type AccessLogEntry as AccessLogEntryDto,
  type AccessLogPage as AccessLogPageDto,
  type AccessLogResource as AccessLogResourceDto,
  type ProfessionalType as ProfessionalTypeDto,
} from '@fit-app/contracts';

import {
  type AccessLogAction,
  type AccessLogEntry,
  type AccessLogPage,
  type AccessLogResource,
} from '../domain/access-log';
import { type ProfessionalType } from '../domain/person';

/**
 * The access log as the contract answers it (card I-06).
 *
 * Three things happen here and nowhere else. The instants become ISO 8601 text
 * in UTC, which is what every client parses (CLAUDE.md, "Dados de saúde"). The
 * two vocabularies are checked against each other: the domain declares its own
 * resources and actions, and the assignments below only compile while the
 * contract still has every value the domain can produce. And `null` becomes
 * absent — a professional type nobody has is a field the answer does not
 * carry, not a `null` every client has to handle.
 *
 * What does **not** cross over is the row id: it is half of the cursor and
 * nothing else, and a client that held it would have an id of a record it can
 * never ask for on its own.
 */
export function toAccessLogEntryResponse(entry: AccessLogEntry): AccessLogEntryDto {
  return {
    actor: {
      name: entry.actor.name,
      ...(entry.actor.professionalType === null
        ? {}
        : { professionalType: toProfessionalType(entry.actor.professionalType) }),
    },
    resource: toAccessLogResource(entry.resource),
    action: toAccessLogAction(entry.action),
    occurredAt: entry.occurredAt.toISOString(),
  };
}

/**
 * The page, in the order the use case answered it: newest first, with the
 * cursor of the next one when there is a next one.
 */
export function toAccessLogPageResponse(page: AccessLogPage): AccessLogPageDto {
  return {
    entries: page.entries.map(toAccessLogEntryResponse),
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
  };
}

/** Where the domain's resources and the contract's are checked to be the same word. */
function toAccessLogResource(resource: AccessLogResource): AccessLogResourceDto {
  return resource;
}

function toAccessLogAction(action: AccessLogAction): AccessLogActionDto {
  return action;
}

function toProfessionalType(type: ProfessionalType): ProfessionalTypeDto {
  return type;
}
