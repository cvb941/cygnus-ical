#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildDateRange,
  fetchCalendarExport,
  parseBoolean,
  parsePositiveInteger,
  validateCalendarOptions,
} from "./calendar-service.js";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  validateCalendarOptions(options);
  const result = await fetchCalendarExport(options);
  const outputFormat = options.format ?? inferFormatFromPath(options.output);
  const outputBody = outputFormat === "jcal" ? JSON.stringify(result.jcal, null, 2) : result.ics;

  const outputPath = path.resolve(process.cwd(), options.output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, outputBody, "utf8");

  process.stdout.write(
    [
      `Instancia: ${result.instanceName}`,
      `Obdobie: ${result.from} -> ${result.to}`,
      `Udalosti: ${result.eventCount}`,
      `Format: ${outputFormat}`,
      `Vystup: ${outputPath}`,
    ].join("\n") + "\n",
  );
}

function parseArgs(argv) {
  const args = {
    email: process.env.CYGNUS_EMAIL,
    password: process.env.CYGNUS_PASSWORD,
    instance: process.env.CYGNUS_INSTANCE,
    timezone: process.env.CYGNUS_TIMEZONE || "Europe/Prague",
    output: "cygnus-shifts.ics",
    format: normalizeFormat(process.env.CYGNUS_FORMAT),
    includeExceptions: parseBoolean(process.env.CYGNUS_INCLUDE_EXCEPTIONS, false),
    calendarName: process.env.CYGNUS_CALENDAR_NAME,
    months: parsePositiveInteger(process.env.CYGNUS_MONTHS, 1),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--include-exceptions") {
      args.includeExceptions = true;
      continue;
    }

    const value = argv[index + 1];

    switch (arg) {
      case "--email":
        args.email = value;
        index += 1;
        break;
      case "--password":
        args.password = value;
        index += 1;
        break;
      case "--instance":
        args.instance = value;
        index += 1;
        break;
      case "--from":
        args.from = value;
        index += 1;
        break;
      case "--to":
        args.to = value;
        index += 1;
        break;
      case "--months":
        args.months = parsePositiveInteger(value, args.months);
        index += 1;
        break;
      case "--output":
        args.output = value;
        index += 1;
        break;
      case "--format":
        args.format = normalizeFormat(value);
        if (!args.format) {
          throw new Error(`Neznamy format: ${value}`);
        }
        index += 1;
        break;
      case "--timezone":
        args.timezone = value;
        index += 1;
        break;
      case "--calendar-name":
        args.calendarName = value;
        index += 1;
        break;
      case "--help":
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Neznamy argument: ${arg}`);
    }
  }

  const today = currentDateString();
  const range = buildDateRange({
    from: args.from,
    to: args.to,
    months: args.months,
    baseDate: today,
  });

  args.from = range.from;
  args.to = range.to;

  return args;
}

function printHelp() {
  process.stdout.write(`Pouzitie:
  node src/cli.js --email EMAIL --password HESLO [moznosti]

Moznosti:
  --instance NAZOV         instancia v Cygnuse, ak ich je viac
  --from YYYY-MM-DD        zaciatok exportu
  --to YYYY-MM-DD          koniec exportu
  --months N               pocet mesiacov od --from, ak nepouzijes --to
  --output SUBOR.ics       vystupny subor
  --format ics|jcal        format vystupu, inak podla pripony suboru
  --timezone ZONA          predvolene Europe/Prague
  --calendar-name NAZOV    nazov kalendara v ICS
  --include-exceptions     prida aj vyjimky
  --help                   vypise tuto napovedu
`);
}

function currentDateString() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeFormat(value) {
  if (!value) {
    return undefined;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["ics", "jcal"].includes(normalized)) {
    return normalized;
  }

  return undefined;
}

function inferFormatFromPath(outputPath) {
  return outputPath.toLowerCase().endsWith(".jcal") ? "jcal" : "ics";
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
