# CygnusIcal

HTTP server, ktory cita pracovne zmeny z `Mobilni Cygnus` a vystavi ich ako `.ics` URL pre odber kalendara.

Nepouziva ziadne externe npm baliky. Staci `node` 18+.

## Endpointy

- `GET /healthz` - healthcheck
- `GET /calendar.ics` - iCal feed

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

## Parametre feedu

Volitelne query parametre:

- `from=YYYY-MM-DD`
- `to=YYYY-MM-DD`
- `months=3`
- `includeExceptions=true`
- `timezone=Europe/Prague`
- `calendarName=Pracovne zmeny`

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

## CLI export

Povodny jednorazovy export ostal k dispozicii:

```bash
npm run export -- --from 2026-03-01 --to 2026-03-31 --output zmeny.ics
```
