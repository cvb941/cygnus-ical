import http from "node:http";

import {
  buildDateRange,
  fetchCalendarExport,
  isIsoDate,
  parseBoolean,
  parsePositiveInteger,
} from "./calendar-service.js";

const config = readConfig(process.env);
const cache = new Map();

validateServerConfig(config);

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

    if (request.method !== "GET") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }

    if (url.pathname === "/healthz") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (url.pathname === "/") {
      sendJson(response, 200, {
        ok: true,
        calendarPath: "/calendar.ics",
        jcalPath: "/calendar.jcal",
        jsonPath: "/calendar.json",
        protected: Boolean(config.calendarToken),
        defaultMonths: config.defaultMonths,
      });
      return;
    }

    if (!["/calendar.ics", "/calendar.jcal", "/calendar.json"].includes(url.pathname)) {
      sendText(response, 404, "Not Found");
      return;
    }

    if (!isAuthorized(url, request.headers, config.calendarToken)) {
      sendText(response, 401, "Unauthorized");
      return;
    }

    const requestOptions = resolveCalendarRequestOptions(url, config);
    const cacheKey = JSON.stringify(requestOptions);
    const now = Date.now();
    const cached = cache.get(cacheKey);

    if (cached && cached.expiresAt > now) {
      if (url.pathname === "/calendar.json") {
        sendJson(response, 200, buildJsonResponse(cached.result, true));
        return;
      }

      if (url.pathname === "/calendar.jcal") {
        sendJcal(response, cached.result.jcal, cached.filename, true);
        return;
      }

      sendCalendar(response, cached.result.ics, cached.filename, true);
      return;
    }

    const result = await fetchCalendarExport({
      email: config.email,
      password: config.password,
      instance: config.instance,
      timezone: requestOptions.timezone,
      calendarName: requestOptions.calendarName,
      includeExceptions: requestOptions.includeExceptions,
      from: requestOptions.from,
      to: requestOptions.to,
    });

    const filename = buildFileName(result.calendarName);
    cache.set(cacheKey, {
      result,
      filename,
      expiresAt: now + config.cacheTtlMs,
    });

    if (url.pathname === "/calendar.json") {
      sendJson(response, 200, buildJsonResponse(result, false));
      return;
    }

    if (url.pathname === "/calendar.jcal") {
      sendJcal(response, result.jcal, filename, false, {
        "X-Cygnus-Instance": result.instanceName,
        "X-Cygnus-Event-Count": String(result.eventCount),
        "X-Cygnus-Range": `${result.from}:${result.to}`,
      });
      return;
    }

    sendCalendar(response, result.ics, filename, false, {
      "X-Cygnus-Instance": result.instanceName,
      "X-Cygnus-Event-Count": String(result.eventCount),
      "X-Cygnus-Range": `${result.from}:${result.to}`,
    });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error.message,
    });
  }
});

server.listen(config.port, config.host, () => {
  process.stdout.write(
    `Cygnus iCal server bezi na http://${config.host}:${config.port}/calendar.ics\n`,
  );
});

function readConfig(env) {
  return {
    host: env.HOST || "0.0.0.0",
    port: parsePositiveInteger(env.PORT, 3000),
    email: env.CYGNUS_EMAIL,
    password: env.CYGNUS_PASSWORD,
    instance: env.CYGNUS_INSTANCE,
    timezone: env.CYGNUS_TIMEZONE || "Europe/Prague",
    calendarName: env.CYGNUS_CALENDAR_NAME,
    includeExceptions: parseBoolean(env.CYGNUS_INCLUDE_EXCEPTIONS, false),
    defaultMonths: parsePositiveInteger(env.CYGNUS_MONTHS, 3),
    calendarToken: env.CALENDAR_TOKEN || "",
    cacheTtlMs: parsePositiveInteger(env.CACHE_TTL_MS, 300000),
  };
}

function validateServerConfig(currentConfig) {
  if (!currentConfig.email) {
    throw new Error("Chyba CYGNUS_EMAIL.");
  }

  if (!currentConfig.password) {
    throw new Error("Chyba CYGNUS_PASSWORD.");
  }
}

function resolveCalendarRequestOptions(url, currentConfig) {
  const queryMonths = parsePositiveInteger(url.searchParams.get("months"), currentConfig.defaultMonths);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const includeExceptions = parseBoolean(
    url.searchParams.get("includeExceptions"),
    currentConfig.includeExceptions,
  );
  const timezone = url.searchParams.get("timezone") || currentConfig.timezone;
  const calendarName = url.searchParams.get("calendarName") || currentConfig.calendarName;

  if (fromParam && !isIsoDate(fromParam)) {
    throw new Error("Parameter from musi mat format YYYY-MM-DD.");
  }

  if (toParam && !isIsoDate(toParam)) {
    throw new Error("Parameter to musi mat format YYYY-MM-DD.");
  }

  const range = buildDateRange({
    from: fromParam || undefined,
    to: toParam || undefined,
    months: queryMonths,
  });

  return {
    from: range.from,
    to: range.to,
    includeExceptions,
    timezone,
    calendarName,
  };
}

function isAuthorized(url, headers, token) {
  if (!token) {
    return true;
  }

  const queryToken = url.searchParams.get("token");
  const headerToken = headers["x-calendar-token"];
  return queryToken === token || headerToken === token;
}

function sendCalendar(response, body, filename, fromCache, extraHeaders = {}) {
  response.writeHead(200, {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": `inline; filename="${filename}"`,
    "Cache-Control": "no-store",
    "X-Cache": fromCache ? "HIT" : "MISS",
    ...extraHeaders,
  });
  response.end(body);
}

function sendJcal(response, body, filename, fromCache, extraHeaders = {}) {
  response.writeHead(200, {
    "Content-Type": "application/calendar+json; charset=utf-8",
    "Content-Disposition": `inline; filename="${replaceExtension(filename, ".jcal")}"`,
    "Cache-Control": "no-store",
    "X-Cache": fromCache ? "HIT" : "MISS",
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function buildFileName(calendarName) {
  const safeName = (calendarName || "cygnus-shifts")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${safeName || "cygnus-shifts"}.ics`;
}

function replaceExtension(filename, extension) {
  return filename.replace(/\.[^.]+$/, extension);
}

function buildJsonResponse(result, fromCache) {
  const monthGrid = buildMonthGrid(result.events, result.from, result.to);

  return {
    ok: true,
    calendarName: result.calendarName,
    instanceName: result.instanceName,
    from: result.from,
    to: result.to,
    eventCount: result.eventCount,
    events: result.events,
    monthGrid,
    cache: fromCache ? "HIT" : "MISS",
  };
}

function buildMonthGrid(events, from, to) {
  const eventsByDate = groupEventsByStartDate(events);
  const monthStart = startOfMonth(from);
  const monthLimit = startOfMonth(to);
  const months = [];
  let cursor = monthStart;

  while (cursor <= monthLimit) {
    const monthEnd = endOfMonth(cursor);
    const gridStart = startOfWeekMonday(cursor);
    const gridEnd = endOfWeekSunday(monthEnd);
    const weeks = [];
    let dayCursor = gridStart;

    while (dayCursor <= gridEnd) {
      const week = [];

      for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
        const shifts = eventsByDate.get(dayCursor) ?? [];

        week.push({
          date: dayCursor,
          day: Number(dayCursor.slice(8, 10)),
          inMonth: dayCursor.slice(0, 7) === cursor.slice(0, 7),
          isToday: dayCursor === currentDateString(),
          shifts,
        });

        dayCursor = addDays(dayCursor, 1);
      }

      weeks.push(week);
    }

    months.push({
      month: cursor.slice(0, 7),
      label: cursor.slice(0, 7),
      weeks,
    });

    cursor = addMonths(cursor, 1);
  }

  return {
    weekStartsOn: "monday",
    weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    months,
  };
}

function groupEventsByStartDate(events) {
  const byDate = new Map();

  for (const event of events ?? []) {
    if (!event?.startDate) {
      continue;
    }

    const dateEvents = byDate.get(event.startDate) ?? [];
    dateEvents.push({
      code: extractShiftCode(event),
      startTime: event.startTime ?? null,
      endTime: event.endTime ?? null,
      summary: event.summary ?? "",
      isNight: isNightShift(event),
    });
    byDate.set(event.startDate, dateEvents);
  }

  return byDate;
}

function extractShiftCode(event) {
  const descriptionMatch = String(event.description ?? "").match(/Typ změny:\s*([A-Z0-9]+)/i);
  if (descriptionMatch?.[1]) {
    return descriptionMatch[1].toUpperCase();
  }

  const summaryMatch = String(event.summary ?? "").match(/\b([A-Z][0-9]+)\b/);
  if (summaryMatch?.[1]) {
    return summaryMatch[1].toUpperCase();
  }

  return "SM";
}

function isNightShift(event) {
  const code = extractShiftCode(event);
  if (code.startsWith("N")) {
    return true;
  }
  return String(event.summary ?? "").toLowerCase().includes("noční");
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

function startOfWeekMonday(date) {
  const dayIndex = dayOfWeek(date);
  const offset = dayIndex === 0 ? -6 : 1 - dayIndex;
  return addDays(date, offset);
}

function endOfWeekSunday(date) {
  const dayIndex = dayOfWeek(date);
  const offset = dayIndex === 0 ? 0 : 7 - dayIndex;
  return addDays(date, offset);
}

function dayOfWeek(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function formatDate(date) {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentDateString() {
  return formatDate(new Date());
}
