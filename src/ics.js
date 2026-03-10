import { createHash } from "node:crypto";

export function buildIcs(events, { calendarName, timeZone }) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CygnusIcal//Work Shifts Export//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    `X-WR-TIMEZONE:${escapeText(timeZone)}`,
  ];

  for (const event of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${buildUid(event)}`);
    lines.push(`DTSTAMP:${formatUtcStamp(new Date())}`);

    if (event.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${event.startDate.replaceAll("-", "")}`);
      lines.push(`DTEND;VALUE=DATE:${event.endDate.replaceAll("-", "")}`);
    } else {
      lines.push(
        `DTSTART;TZID=${timeZone}:${formatLocalDateTime(event.startDate, event.startTime)}`,
      );
      lines.push(
        `DTEND;TZID=${timeZone}:${formatLocalDateTime(event.endDate, event.endTime)}`,
      );
    }

    lines.push(`SUMMARY:${escapeText(event.summary)}`);

    if (event.description) {
      lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    }

    if (event.location) {
      lines.push(`LOCATION:${escapeText(event.location)}`);
    }

    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  lines.push("");

  return lines.join("\r\n");
}

function buildUid(event) {
  const input = [
    event.startDate,
    event.startTime ?? "",
    event.endDate,
    event.endTime ?? "",
    event.summary,
    event.description ?? "",
  ].join("|");

  return `${createHash("sha256").update(input).digest("hex").slice(0, 24)}@cygnus-ical`;
}

function formatUtcStamp(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

function formatLocalDateTime(date, time) {
  const compactDate = date.replaceAll("-", "");
  const compactTime = time.replace(":", "") + "00";
  return `${compactDate}T${compactTime}`;
}

function escapeText(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}
