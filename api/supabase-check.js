
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const url = process.env.supabase_url;
  const secret = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secret) {
    return res.status(500).json({
      ok: false,
      error: "Faltan variables de entorno en Vercel"
    });
  }

  try {
    const baseUrl = url.replace(/\/+$/, "");

    const response = await fetch(
      `${baseUrl}/rest/v1/mw_orders?select=id&limit=0`,
      {
        method: "GET",
        headers: {
          apikey: secret,
          Authorization: `Bearer ${secret}`
        }
      }
    );

    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        error: "Supabase respondió con un error",
        status: response.status
      });
    }

    return res.status(200).json({
      ok: true,
      service: "marketWeb",
      supabase: "connected"
    });
  } catch {
    return res.status(502).json({
      ok: false,
      error: "No se pudo conectar con Supabase"
    });
  }
};
