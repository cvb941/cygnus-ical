import { createHash } from "node:crypto";

export function buildJcal(events, { calendarName, timeZone }) {
  return [
    "vcalendar",
    [
      ["version", {}, "text", "2.0"],
      ["prodid", {}, "text", "-//CygnusIcal//Work Shifts Export//EN"],
      ["calscale", {}, "text", "GREGORIAN"],
      ["method", {}, "text", "PUBLISH"],
      ["x-wr-calname", {}, "text", calendarName],
      ["x-wr-timezone", {}, "text", timeZone],
    ],
    events.map((event) => buildJcalEvent(event, timeZone)),
  ];
}

function buildJcalEvent(event, timeZone) {
  const properties = [
    ["uid", {}, "text", buildUid(event)],
    ["dtstamp", {}, "date-time", formatUtcStamp(new Date())],
  ];

  if (event.allDay) {
    properties.push(["dtstart", {}, "date", event.startDate]);
    properties.push(["dtend", {}, "date", event.endDate]);
  } else {
    properties.push([
      "dtstart",
      { tzid: timeZone },
      "date-time",
      formatLocalDateTime(event.startDate, event.startTime),
    ]);
    properties.push([
      "dtend",
      { tzid: timeZone },
      "date-time",
      formatLocalDateTime(event.endDate, event.endTime),
    ]);
  }

  properties.push(["summary", {}, "text", event.summary]);

  if (event.description) {
    properties.push(["description", {}, "text", event.description]);
  }

  if (event.location) {
    properties.push(["location", {}, "text", event.location]);
  }

  return ["vevent", properties, []];
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
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}Z`;
}

function formatLocalDateTime(date, time) {
  return `${date}T${time}:00`;
}
