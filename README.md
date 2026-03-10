# CygnusIcal

HTTP server, ktory cita pracovne zmeny z `Mobilni Cygnus` a vystavi ich ako `.ics` alebo `jCal` URL pre odber kalendara.

Nepouziva ziadne externe npm baliky. Staci `node` 18+.

## Endpointy

- `GET /healthz` - healthcheck
- `GET /calendar.ics` - iCal feed
- `GET /calendar.jcal` - jCal feed (`application/calendar+json`)
- `GET /calendar.json` - JSON feed pre vlastne integracie (napr. Laravel/TRMNL)

Ak nastavis `CALENDAR_TOKEN`, feed je chraneny a treba volat:

```text
/calendar.ics?token=tajny_token
```

## Konfiguracia

Povinne:

- `CYGNUS_EMAIL`
- `CYGNUS_PASSWORD`

Volitelne:

- `CYGNUS_INSTANCE` - ak ma konto viac instancii
- `CYGNUS_TIMEZONE` - default `Europe/Prague`
- `CYGNUS_CALENDAR_NAME` - vlastny nazov kalendara
- `CYGNUS_INCLUDE_EXCEPTIONS=true` - prida vyjimky
- `CYGNUS_MONTHS=3` - kolko mesiacov dopredu ma feed generovat, ak neposles `from` a `to`
- `CALENDAR_TOKEN` - ochrana feedu
- `PORT=3000`
- `HOST=0.0.0.0`
- `CACHE_TTL_MS=300000`

## Spustenie lokalne

```bash
CYGNUS_EMAIL='tvoj@email.sk' \
CYGNUS_PASSWORD='tvoje_heslo' \
CYGNUS_INSTANCE='08207364' \
CALENDAR_TOKEN='tajny_token' \
node src/server.js
```

Feed potom bude dostupny napr. na:

```text
http://localhost:3000/calendar.ics?token=tajny_token
```

JSON feed:

```text
http://localhost:3000/calendar.json?token=tajny_token
```

jCal feed:

```text
http://localhost:3000/calendar.jcal?token=tajny_token
```

## Parametre feedu

Volitelne query parametre:

- `from=YYYY-MM-DD`
- `to=YYYY-MM-DD`
- `months=3`
- `includeExceptions=true`
- `timezone=Europe/Prague`
- `calendarName=Cygnus směny`

Ak neposles `from` a `to`, server vracia rolling rozsah od zaciatku aktualneho mesiaca na pocet mesiacov podla `CYGNUS_MONTHS`.

## Docker

Build image:

```bash
docker build -t cygnus-ical .
```

Spustenie servera:

```bash
docker run --rm -p 3000:3000 \
  -e CYGNUS_EMAIL='tvoj@email.sk' \
  -e CYGNUS_PASSWORD='tvoje_heslo' \
  -e CYGNUS_INSTANCE='08207364' \
  -e CALENDAR_TOKEN='tajny_token' \
  cygnus-ical
```

Feed URL:

```text
http://localhost:3000/calendar.ics?token=tajny_token
```

JSON URL:

```text
http://localhost:3000/calendar.json?token=tajny_token
```

jCal URL:

```text
http://localhost:3000/calendar.jcal?token=tajny_token
```

## Docker Compose

Skopiruj `.env.example` na `.env` a dopln hodnoty:

```bash
cp .env.example .env
```

Spustenie:

```bash
docker compose up -d
```

Zastavenie:

```bash
docker compose down
```

Feed URL:

```text
http://localhost:3000/calendar.ics?token=tajny_token
```

## Push skript

Multi-arch push na Docker Hub:

```bash
sh scripts/push_dockerhub.sh
```

Volitelne:

```bash
IMAGE_NAME=cvb941/cygnus-ical IMAGE_TAG=latest sh scripts/push_dockerhub.sh
```

JSON URL:

```text
http://localhost:3000/calendar.json?token=tajny_token
```

## CLI export

Povodny jednorazovy export ostal k dispozicii:

```bash
npm run export -- --from 2026-03-01 --to 2026-03-31 --output zmeny.ics
```

Export do `jCal`:

```bash
npm run export -- --from 2026-03-01 --to 2026-03-31 --format jcal --output zmeny.jcal
```

## Laravel / TRMNL

Pre TRMNL je spravidla lepsie pouzit `JSON` alebo `ICS`, nie `CalDAV`.

- `ICS` je vhodny, ak chces len odber kalendara.
- `JSON` je vhodnejsi pre vlastny Laravel widget/plugin, lebo sa jednoducho parsuje a renderuje.
- `CalDAV` sa oplati az ked potrebujes obojsmernu sync logiku, kolekcie, ETagy, update/delete operacie a kompatibilitu s kalendarovymi klientmi.

Priklad jednoducheho Laravel requestu:

```php
$response = Http::timeout(15)->get('http://cygnus-ical:3000/calendar.json', [
    'token' => config('services.cygnus_ical.token'),
    'months' => 1,
]);

$events = collect($response->json('events', []))
    ->filter(fn (array $event) => empty($event['allDay']))
    ->sortBy('startsAt')
    ->take(5)
    ->values();
```

JSON odpoved obsahuje:

- `calendarName`
- `instanceName`
- `from`, `to`
- `eventCount`
- `events[]` s polami `summary`, `description`, `startDate`, `startTime`, `endDate`, `endTime`, `startsAt`, `endsAt`, `allDay`
- `monthGrid` pre jednoduche renderovanie mesacnej mriezky v Liquid/TRMNL:
  - `weekStartsOn`, `weekdays[]`
  - `months[]` kde kazdy mesiac ma `month`, `label`, `weeks[]`
  - `weeks[]` je pole tyzdnov, kazdy tyzden ma 7 dni:
    - `date`, `day`, `inMonth`, `isToday`, `shifts[]`
    - `shifts[]` ma `code`, `startTime`, `endTime`, `summary`, `isNight`

Hotovy Laravel widget priklad je v [examples/laravel-trmnl/README.md](/Users/cvb941/src/CygnusIcal/examples/laravel-trmnl/README.md).
