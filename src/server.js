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
        protected: Boolean(config.calendarToken),
        defaultMonths: config.defaultMonths,
      });
      return;
    }

    if (url.pathname !== "/calendar.ics") {
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
      sendCalendar(response, cached.ics, cached.filename, true);
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
      ics: result.ics,
      filename,
      expiresAt: now + config.cacheTtlMs,
    });

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
