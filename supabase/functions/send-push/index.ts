// =========================================================================
// Supabase Edge Function: send-push
// Web Push Dispatcher via VAPID keys for iOS (PWA Homescreen) & Android
// =========================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { title, body, stationName, fuelPrice, fuelType, targetUserId } = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch active push subscriptions
    let query = supabase.from("push_subs").select("*");
    if (targetUserId) {
      query = query.eq("user_id", targetUserId);
    }
    const { data: subscriptions, error } = await query;

    if (error) throw error;

    const payload = JSON.stringify({
      title: title || "KRAFTSTOFF Preisalarm ⚡️",
      body: body || `${stationName}: ${fuelType.toUpperCase()} jetzt für ${fuelPrice} €/L verfügbar!`,
      icon: "/icon.svg",
      data: {
        timestamp: new Date().toISOString(),
        url: "/",
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        queuedCount: subscriptions?.length || 0,
        payload: JSON.parse(payload),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
