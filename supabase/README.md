# Supabase Backend Setup für KRAFTSTOFF Tankpreis-App

Dieses Verzeichnis enthält die vollständige Backend-Architektur gemäß der Spezifikation.

## 1. Schema & Tabellen einrichten
Führe das SQL-Skript `schema.sql` im Supabase SQL Editor oder via Supabase CLI aus:

```bash
supabase db push
# oder den Inhalt von schema.sql direkt im Supabase Dashboard unter "SQL Editor" einfügen und "Run" drücken.
```

Folgende Tabellen werden angelegt:
- `stations`: Tankstellen-Stammdaten mit Geokoordinaten und Marken.
- `prices`: Historische Zeitreihen mit Diesel, E5 und E10 Preisen.
- `user_settings`: Schwellenwerte, bevorzugte Kraftstoffart, Pendelzeiten und Alarm-Pausierung.
- `push_subs`: Registrierte Web Push Subscription-Tokens für native Benachrichtigungen.
- `laws_taxes`: Dynamische Gesetzgebungs- und Steuerparameter (z.B. Tankrabatt, CO2-Preise).

## 2. Edge Functions deployen
Deploye die Edge Functions für den 5-minütigen Tankerkönig-Cronjob und Web-Push:

```bash
supabase functions deploy sync-tankerkoenig
supabase functions deploy send-push
```

## 3. Umgebungsvariablen (Secrets) konfigurieren
Setze deine API-Keys im Supabase Dashboard unter *Project Settings > Edge Functions*:
- `TANKERKOENIG_API_KEY`: Dein persönlicher Tankerkönig API-Key (kostenlos auf tankerkoenig.de).
- `SUPABASE_URL`: Die URL deiner Supabase-Instanz.
- `SUPABASE_SERVICE_ROLE_KEY`: Der Service Role Key mit Schreibrechten.

## 4. Cronjob (pg_cron)
Aktiviere die 5-Minuten-Abfrage in Supabase mit pg_cron:
```sql
SELECT cron.schedule(
    'sync-tankerkoenig-5min',
    '*/5 * * * *',
    $$
    SELECT net.http_post(
        url := 'https://<PROJECT_REF>.functions.supabase.co/sync-tankerkoenig',
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer <SERVICE_ROLE_KEY>"}'::jsonb
    ) as request_id;
    $$
);
```
