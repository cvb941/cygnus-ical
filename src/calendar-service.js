import { CygnusClient } from "./cygnus-client.js";
import { buildIcs } from "./ics.js";
import { buildJcal } from "./jcal.js";

export async function fetchCalendarExport(options) {
  validateCalendarOptions(options);

  const client = new CygnusClient({
    email: options.email,
    password: options.password,
    instanceName: options.instance,
  });

  const loginInfo = await client.login();
  const months = enumerateMonths(options.from, options.to);
  const allEvents = [];

  for (const monthDate of months) {
    const payload = await client.getMonthlyPlan(monthDate);
    const events = monthlyPlanToEvents(payload, {
      includeExceptions: options.includeExceptions,
    });
    allEvents.push(...events);
  }

  const dedupedEvents = dedupeEvents(
    allEvents.filter((event) => isDateInRange(event.startDate, options.from, options.to)),
  ).sort(compareEvents);

  const calendarName = options.calendarName ?? `Cygnus směny (${loginInfo.instanceName})`;
  const ics = buildIcs(dedupedEvents, {
    calendarName,
    timeZone: options.timezone,
  });
  const jcal = buildJcal(dedupedEvents, {
    calendarName,
    timeZone: options.timezone,
  });

  return {
    ics,
    jcal,
    eventCount: dedupedEvents.length,
    events: dedupedEvents.map((event) => serializeEvent(event, options.timezone)),
    instanceName: loginInfo.instanceName,
    from: options.from,
    to: options.to,
    calendarName,
  };
}

export function buildDateRange({ from, to, months, baseDate = currentDateString() }) {
  const normalizedMonths = Number.isInteger(months) && months > 0 ? months : 1;
  const resolvedFrom = from ?? startOfMonth(baseDate);
  const resolvedTo = to ?? endOfMonth(addMonths(resolvedFrom, normalizedMonths - 1));

  return {
    from: resolvedFrom,
    to: resolvedTo,
  };
}

export function validateCalendarOptions(options) {
  if (!options.email) {
    throw new Error("Chyba email. Pouzi CYGNUS_EMAIL alebo --email.");
  }

  if (!options.password) {
    throw new Error("Chyba heslo. Pouzi CYGNUS_PASSWORD alebo --password.");
  }

  if (!isIsoDate(options.from) || !isIsoDate(options.to)) {
    throw new Error("Datumy musia mat format YYYY-MM-DD.");
  }

  if (options.from > options.to) {
    throw new Error("Zaciatocny datum nemoze byt vacsi ako koncovy.");
  }
}

export function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

export function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function monthlyPlanToEvents(payload, { includeExceptions }) {
  const events = [];
  const contracts = payload?.Smlouvy ?? [];

  for (const contract of contracts) {
    const contractName = contract.Nazev;
    const days = contract.DnyZamestnance ?? [];

    for (const day of days) {
      const date = normalizeCygnusDate(day.Datum);
      if (!date) {
        continue;
      }

      for (const shift of day.Smeny ?? []) {
        const parsed = parseTimeRange(shift.CasSmeny, date);
        if (!parsed) {
          continue;
        }

        const descriptionLines = [
          `Typ změny: ${shift.Zkratka}`,
          `Čas: ${formatDisplayTimeRange(parsed.startTime, parsed.endTime)}`,
          contractName ? `Smlouva: ${contractName}` : null,
          shift.CasSmeny ? `Text z Cygnusu: ${shift.CasSmeny}` : null,
          shift.Poznamka ? `Poznámka: ${shift.Poznamka}` : null,
          shift.PoznamkaPosunu ? `Poznámka posunu: ${shift.PoznamkaPosunu}` : null,
          (shift.PreruseniSmeny ?? []).length
            ? `Přerušení: ${(shift.PreruseniSmeny ?? []).join(", ")}`
            : null,
        ].filter(Boolean);

        events.push({
          startDate: parsed.startDate,
          startTime: parsed.startTime,
          endDate: parsed.endDate,
          endTime: parsed.endTime,
          summary: formatShiftSummary(shift.Zkratka, parsed.startTime, parsed.endTime),
          description: descriptionLines.join("\n"),
        });
      }

      if (!includeExceptions) {
        continue;
      }

      for (const exception of day.Vyjimky ?? []) {
        const parsed = parseTimeRange(exception.CasVyjimky, date);
        if (parsed) {
          events.push({
            startDate: parsed.startDate,
            startTime: parsed.startTime,
            endDate: parsed.endDate,
            endTime: parsed.endTime,
            summary: formatExceptionSummary(
              exception.Zkratka,
              parsed.startTime,
              parsed.endTime,
            ),
            description: [
              `Typ výjimky: ${exception.Zkratka}`,
              `Čas: ${formatDisplayTimeRange(parsed.startTime, parsed.endTime)}`,
              contractName ? `Smlouva: ${contractName}` : null,
              exception.CasVyjimky ? `Text z Cygnusu: ${exception.CasVyjimky}` : null,
              exception.Poznamka ? `Poznámka: ${exception.Poznamka}` : null,
            ]
              .filter(Boolean)
              .join("\n"),
          });
          continue;
        }

        events.push({
          startDate: date,
          endDate: addDays(date, 1),
          allDay: true,
          summary: formatExceptionSummary(exception.Zkratka),
          description: [
            `Typ výjimky: ${exception.Zkratka}`,
            contractName ? `Smlouva: ${contractName}` : null,
            exception.CasVyjimky ? `Text z Cygnusu: ${exception.CasVyjimky}` : null,
            exception.Poznamka ? `Poznámka: ${exception.Poznamka}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        });
      }
    }
  }

  return events;
}

function parseTimeRange(label, date) {
  if (!label) {
    return null;
  }

  const match = label.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
  if (!match) {
    return null;
  }

  const [, startRaw, endRaw] = match;
  const startMinutes = toMinutes(startRaw);
  const endMinutes = toMinutes(endRaw);
  const normalizedStartTime = normalizeTime(startRaw);
  const normalizedEndTime = normalizeTime(endRaw);

  if (startMinutes === null || endMinutes === null) {
    return null;
  }

  const crossesMidnight =
    endMinutes < startMinutes || (endMinutes === startMinutes && startRaw !== endRaw);

  return {
    startDate: normalize24HourDate(date, startRaw),
    startTime: normalizedStartTime,
    endDate: crossesMidnight || endRaw.startsWith("24:") ? addDays(date, 1) : date,
    endTime: normalizedEndTime,
  };
}

function normalize24HourDate(date, time) {
  return time.startsWith("24:") ? addDays(date, 1) : date;
}

function normalizeTime(time) {
  const [hourText, minuteText] = time.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    return null;
  }

  const normalizedHour = hour === 24 ? 0 : hour;
  return `${String(normalizedHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function toMinutes(time) {
  const normalized = normalizeTime(time);
  if (!normalized) {
    return null;
  }

  const [hourText, minuteText] = normalized.split(":");
  return Number(hourText) * 60 + Number(minuteText);
}

function dedupeEvents(events) {
  const map = new Map();

  for (const event of events) {
    const key = [
      event.summary,
      event.startDate,
      event.startTime ?? "",
      event.endDate,
      event.endTime ?? "",
      event.description ?? "",
    ].join("|");
    map.set(key, event);
  }

  return [...map.values()];
}

function compareEvents(left, right) {
  return [
    left.startDate.localeCompare(right.startDate),
    (left.startTime ?? "").localeCompare(right.startTime ?? ""),
    left.summary.localeCompare(right.summary),
  ].find((value) => value !== 0) ?? 0;
}

function enumerateMonths(from, to) {
  const result = [];
  let current = startOfMonth(from);
  const limit = startOfMonth(to);

  while (current <= limit) {
    result.push(current);
    current = addMonths(current, 1);
  }

  return result;
}

function startOfMonth(date) {
  return `${date.slice(0, 7)}-01`;
}

function endOfMonth(date) {
  const [year, month] = date.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0));
  return formatDate(lastDay);
}

function addMonths(date, months) {
  const [yearText, monthText] = date.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const totalMonths = year * 12 + (month - 1) + months;
  const nextYear = Math.floor(totalMonths / 12);
  const nextMonth = (totalMonths % 12) + 1;
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`;
}

function addDays(date, days) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return formatDate(next);
}

function formatDate(date) {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isDateInRange(date, from, to) {
  return date >= from && date <= to;
}

function normalizeCygnusDate(value) {
  if (!value) {
    return null;
  }

  if (isIsoDate(value)) {
    return value;
  }

  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) {
    return null;
  }

  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

function formatShiftSummary(code, startTime, endTime) {
  const label = describeCode(code, "Smena");
  return `${label} (${formatDisplayTimeRange(startTime, endTime)})`;
}

function formatExceptionSummary(code, startTime, endTime) {
  const label = describeCode(code, "Vyjimka");
  if (!startTime || !endTime) {
    return label;
  }
  return `${label} (${formatDisplayTimeRange(startTime, endTime)})`;
}

function describeCode(code, fallbackPrefix) {
  if (!code) {
    return fallbackPrefix;
  }

  const normalized = String(code).trim().toUpperCase();
  const firstChar = normalized[0];
  const labelByPrefix = {
    D: "Denní směna",
    N: "Noční směna",
    R: "Ranní směna",
    O: "Odpolední směna",
    V: "Volno",
    S: "Služba",
  };

  const label = labelByPrefix[firstChar] ?? fallbackPrefix;
  return `${label} ${normalized}`.trim();
}

function formatDisplayTimeRange(startTime, endTime) {
  if (!startTime || !endTime) {
    return "";
  }

  return `${startTime}-${endTime}`;
}

function currentDateString() {
  return formatDate(new Date());
}

function serializeEvent(event, timezone) {
  return {
    ...event,
    timezone,
    startsAt: event.allDay ? `${event.startDate}T00:00:00` : `${event.startDate}T${event.startTime}:00`,
    endsAt: event.allDay ? `${event.endDate}T00:00:00` : `${event.endDate}T${event.endTime}:00`,
  };
}
