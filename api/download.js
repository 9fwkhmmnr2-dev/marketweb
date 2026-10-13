
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido." });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !secretKey) {
    return res.status(500).json({
      error: "Configuración del servidor incompleta.",
    });
  }

  const authorization = req.headers.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return res.status(401).json({
      error: "Iniciá sesión para continuar.",
    });
  }

  const accessToken = match[1];

  try {
    // Verificar la identidad del usuario con Supabase Auth.
    const authResponse = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`,
      {
        headers: {
          apikey: secretKey,
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!authResponse.ok) {
      return res.status(401).json({
        error: "La sesión venció. Iniciá sesión nuevamente.",
      });
    }

    const user = await authResponse.json();

    if (!user?.id) {
      return res.status(401).json({
        error: "Sesión inválida.",
      });
    }

    const orderId = req.body?.orderId;

    if (
      typeof orderId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)
    ) {
      return res.status(400).json({
        error: "Identificador de compra inválido.",
      });
    }

    // Buscar exclusivamente una orden del usuario autenticado.
    const query =
      `/rest/v1/mw_orders?id=eq.${encodeURIComponent(orderId)}` +
      `&user_id=eq.${encodeURIComponent(user.id)}` +
      "&select=id,status,amount,currency,html_snapshot,html_sha256,mp_payment_id" +
      "&limit=1";

    const orderResponse = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}${query}`,
      {
        headers: {
          apikey: secretKey,
          Authorization: `Bearer ${secretKey}`,
        },
      }
    );

    if (!orderResponse.ok) {
      return res.status(500).json({
        error: "No pudimos comprobar la compra.",
      });
    }

    const orders = await orderResponse.json();
    const order = Array.isArray(orders) ? orders[0] : null;

    if (!order) {
      return res.status(404).json({
        error: "No encontramos esa compra para tu cuenta.",
      });
    }

    // Una orden pendiente o rechazada nunca permite descargar.
    if (
      order.status !== "paid" ||
      Number(order.amount) !== 4990 ||
      order.currency !== "ARS" ||
      !order.mp_payment_id
    ) {
      return res.status(403).json({
        error: "La compra todavía no está verificada.",
      });
    }

    if (
      typeof order.html_snapshot !== "string" ||
      !order.html_snapshot ||
      Buffer.byteLength(order.html_snapshot, "utf8") > 300000
    ) {
      return res.status(500).json({
        error: "El archivo de la compra no está disponible.",
      });
    }

    // Comprobar que el archivo coincide con el hash guardado al crear la orden.
    const { createHash, timingSafeEqual } = await import("node:crypto");

    const calculatedHash = createHash("sha256")
      .update(order.html_snapshot, "utf8")
      .digest("hex");

    const expected = Buffer.from(order.html_sha256 || "", "hex");
    const actual = Buffer.from(calculatedHash, "hex");

    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      return res.status(500).json({
        error: "No se pudo verificar la integridad del archivo.",
      });
    }

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="marketweb-plantilla.html"'
    );

    return res.status(200).send(order.html_snapshot);
  } catch {
    return res.status(500).json({
      error: "Error interno al preparar la descarga.",
    });
  }
}
