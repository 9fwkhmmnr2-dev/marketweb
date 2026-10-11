
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secret) {
    return res.status(500).json({
      ok: false,
      error: "Faltan variables de entorno"
    });
  }

  try {
    const baseUrl = url.replace(/\/+$/, "");

    const response = await fetch(
      `${baseUrl}/storage/v1/bucket/published-sites`,
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
        error: "No se pudo verificar el bucket",
        status: response.status
      });
    }

    return res.status(200).json({
      ok: true,
      service: "marketWeb",
      storage: "connected",
      bucket: "published-sites"
    });
  } catch {
    return res.status(502).json({
      ok: false,
      error: "No se pudo conectar con Storage"
    });
  }
};
