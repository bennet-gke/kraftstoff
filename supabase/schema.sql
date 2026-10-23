-- =========================================================================
-- KRAFTSTOFF: Supabase PostgreSQL Schema & Konfiguration
-- Nach Spezifikation: Tankpreis-App (Architektur & KI-Agenten Richtlinien)
-- =========================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. TANKSTELLEN-METADATEN (stations)
CREATE TABLE IF NOT EXISTS public.stations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tankerkoenig_id VARCHAR(64) UNIQUE,
    name VARCHAR(255) NOT NULL,
    brand VARCHAR(100),
    street VARCHAR(255),
    house_number VARCHAR(32),
    post_code VARCHAR(16),
    city VARCHAR(100),
    latitude NUMERIC(9, 6) NOT NULL,
    longitude NUMERIC(9, 6) NOT NULL,
    is_open BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for spatial and lookup operations
CREATE INDEX IF NOT EXISTS idx_stations_brand ON public.stations(brand);
CREATE INDEX IF NOT EXISTS idx_stations_city ON public.stations(city);
CREATE INDEX IF NOT EXISTS idx_stations_coords ON public.stations(latitude, longitude);

-- 2. HISTORISCHE PREISDATEN (prices)
CREATE TABLE IF NOT EXISTS public.prices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    station_id UUID REFERENCES public.stations(id) ON DELETE CASCADE,
    fuel_type VARCHAR(20) NOT NULL CHECK (fuel_type IN ('diesel', 'e5', 'e10')),
    price NUMERIC(5, 3) NOT NULL, -- e.g. 1.749 €
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Compound index for fast time-series queries and volatility calculation
CREATE INDEX IF NOT EXISTS idx_prices_station_fuel_time 
ON public.prices(station_id, fuel_type, timestamp DESC);

-- 3. NUTZEREINSTELLUNGEN & ROUTEN (user_settings)
CREATE TABLE IF NOT EXISTS public.user_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID, -- References auth.users(id) if Supabase Auth is enabled
    fuel_preference VARCHAR(20) DEFAULT 'diesel' CHECK (fuel_preference IN ('diesel', 'e5', 'e10')),
    alert_threshold_cent NUMERIC(4, 1) DEFAULT 3.0, -- Alert when price is >= 3.0 ct cheaper than dynamic avg
    favorite_station_ids UUID[] DEFAULT ARRAY[]::UUID[],
    home_work_route_active BOOLEAN DEFAULT true,
    commute_morning_start TIME DEFAULT '07:30:00',
    commute_morning_end TIME DEFAULT '08:45:00',
    commute_evening_start TIME DEFAULT '16:30:00',
    commute_evening_end TIME DEFAULT '18:30:00',
    paused_until TIMESTAMPTZ DEFAULT NULL, -- For interactive "Bin noch auf der Arbeit" snooze
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. PUSH-BENACHRICHTIGUNGEN SUBSCRIPTIONS (push_subs)
CREATE TABLE IF NOT EXISTS public.push_subs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_notified_at TIMESTAMPTZ
);

-- 5. GESETZE UND STEUERN KONFIGURATION (laws_taxes)
-- Ermöglicht dynamische Anpassungen ohne Code-Deployment (z.B. Tankrabatt, CO2-Preisanpassungen)
CREATE TABLE IF NOT EXISTS public.laws_taxes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key VARCHAR(64) UNIQUE NOT NULL,
    label VARCHAR(255) NOT NULL,
    discount_cent NUMERIC(4, 2) DEFAULT 0.00, -- Rabatt oder Aufschlag in Cent (z.B. -15.00 für Rabatt)
    is_active BOOLEAN DEFAULT false,
    description TEXT,
    valid_from DATE,
    valid_to DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security (RLS) Aktivierung
ALTER TABLE public.stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.laws_taxes ENABLE ROW LEVEL SECURITY;

-- Öffentliche Lese-Policies für transparente Daten
CREATE POLICY "Public stations read" ON public.stations FOR SELECT USING (true);
CREATE POLICY "Public prices read" ON public.prices FOR SELECT USING (true);
CREATE POLICY "Public laws_taxes read" ON public.laws_taxes FOR SELECT USING (true);

-- Settings & Push Subs policies
CREATE POLICY "Public user_settings manage" ON public.user_settings FOR ALL USING (true);
CREATE POLICY "Public push_subs manage" ON public.push_subs FOR ALL USING (true);

-- 6. SEED-DATEN (Konfiguration für Gesetze & Steuern)
INSERT INTO public.laws_taxes (key, label, discount_cent, is_active, description)
VALUES 
    ('tankrabatt_temporaer', 'Temporärer Bundes-Tankrabatt', -14.00, false, 'Staatliche temporäre Entlastung zur Senkung der Energiesteuer'),
    ('co2_preisanpassung', 'CO2-Steuer Stufe 2026', 4.50, true, 'Gesetzliche CO2-Abgabe pro Liter Kraftstoff'),
    ('pendlerpauschale_ausgleich', 'Pendler-Sofortbonus', -3.00, false, 'Regionaler Arbeitspendler-Zuschuss')
ON CONFLICT (key) DO NOTHING;

-- 7. SEED-DATEN (Beispiel-Tankstellen in Deutschland)
INSERT INTO public.stations (tankerkoenig_id, name, brand, street, house_number, post_code, city, latitude, longitude, is_open)
VALUES
    ('tk-aral-alex', 'Aral Tankstelle Alexanderplatz', 'Aral', 'Alexanderstraße', '1', '10178', 'Berlin', 52.5219, 13.4132, true),
    ('tk-shell-potsdam', 'Shell Station Potsdamer Platz', 'Shell', 'Potsdamer Str.', '12', '10785', 'Berlin', 52.5085, 13.3756, true),
    ('tk-jet-charlotte', 'JET Tankstelle Bismarckstraße', 'JET', 'Bismarckstr.', '88', '10627', 'Berlin', 52.5115, 13.3050, true),
    ('tk-total-schöne', 'TotalEnergies Hauptstraße', 'TotalEnergies', 'Hauptstraße', '45', '10827', 'Berlin', 52.4850, 13.3540, true),
    ('tk-hem-kreuzberg', 'HEM Tankstelle Mehringdamm', 'HEM', 'Mehringdamm', '32', '10961', 'Berlin', 52.4920, 13.3880, true),
    ('tk-esso-prenzl', 'Esso Station Danziger Straße', 'Esso', 'Danziger Str.', '102', '10405', 'Berlin', 52.5360, 13.4280, true)
ON CONFLICT (tankerkoenig_id) DO NOTHING;
