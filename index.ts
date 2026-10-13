import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Artist photos: Deezer's public search (no key), falling back to Ticketmaster's image.
const photoCache = new Map<string, string | null>();
async function deezerPhoto(name: string) {
  if (photoCache.has(name)) return photoCache.get(name)!;
  const r = await fetch(`https://api.deezer.com/search/artist?limit=1&q=${encodeURIComponent(name)}`)
    .then((x) => x.json()).catch(() => null);
  const url = r?.data?.[0]?.picture_big ?? null;
  photoCache.set(name, url);
  return url;
}

Deno.serve(async () => {
  const api = `https://app.ticketmaster.com/discovery/v2/events.json?classificationName=music` +
    `&countryCode=US&size=100&sort=date,asc&apikey=${Deno.env.get("TM_API_KEY")}`;
  const events = (await (await fetch(api)).json())._embedded?.events ?? [];

  let synced = 0;
  for (const e of events) {
    const a = e._embedded?.attractions?.[0];
    const v = e._embedded?.venues?.[0];
    if (!a) continue;

    const tmImage = [...(a.images ?? [])].sort((x, y) => y.width - x.width)[0]?.url ?? null;
    const image_url = (await deezerPhoto(a.name)) ?? tmImage;

    const { data: artist } = await db.from("artists")
      .upsert({ tm_id: a.id, name: a.name, image_url, updated_at: new Date() }, { onConflict: "tm_id" })
      .select("id").single();
    if (!artist) continue;

    await db.from("concerts").upsert({
      tm_id: e.id,
      artist_id: artist.id,
      name: e.name,
      venue: v?.name,
      city: v?.city?.name,
      starts_at: e.dates?.start?.dateTime ?? e.dates?.start?.localDate,
      url: e.url,
      updated_at: new Date(),
    }, { onConflict: "tm_id" });
    synced++;
  }
  return Response.json({ synced });
});
