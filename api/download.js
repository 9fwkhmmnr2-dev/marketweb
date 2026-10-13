
import { createHash, timingSafeEqual } from "node:crypto";

const PRODUCT_AMOUNT = 4990;
const CURRENCY = "ARS";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido." });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const mpToken = process.env.MERCADOPAGO_ACCESS_TOKEN;

  if (!supabaseUrl || !secretKey || !mpToken) {
    return res.status(500).json({
      error: "La configuración del servidor está incompleta.",
    });
  }

  const match = (req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return res.status(401).json({ error: "Iniciá sesión para continuar." });
  }

  try {
    const baseUrl = supabaseUrl.replace(/\/+$/, "");

    // 1. Verificar la sesión del comprador.
    const authResponse = await fetch(`${baseUrl}/auth/v1/user`, {
      headers: {
        apikey: secretKey,
        Authorization: `Bearer ${match[1]}`,
      },
    });

    if (!authResponse.ok) {
      return res.status(401).json({
        error: "La sesión venció. Iniciá sesión nuevamente.",
      });
    }

    const user = await authResponse.json();

    if (!user?.id) {
      return res.status(401).json({ error: "Sesión inválida." });
    }

    // 2. Validar el identificador de compra.
    const orderId = req.body?.orderId;

    if (typeof orderId !== "string" || !UUID_RE.test(orderId)) {
      return res.status(400).json({
        error: "Identificador de compra inválido.",
      });
    }

    // 3. Consultar una orden que pertenezca a este usuario.
    const orderUrl = new URL(`${baseUrl}/rest/v1/mw_orders`);
    orderUrl.searchParams.set("id", `eq.${orderId}`);
    orderUrl.searchParams.set("user_id", `eq.${user.id}`);
    orderUrl.searchParams.set(
      "select",
      "id,status,amount,currency,html_snapshot,html_sha256,mp_payment_id,preference_id,external_reference"
    );
    orderUrl.searchParams.set("limit", "1");

    const orderResponse = await fetch(orderUrl, {
      headers: {
        apikey: secretKey,
        Authorization: `Bearer ${secretKey}`,
      },
    });

    if (!orderResponse.ok) {
      return res.status(500).json({
        error: "No pudimos consultar la compra.",
      });
    }

    const orders = await orderResponse.json();
    const order = Array.isArray(orders) ? orders[0] : null;

    if (!order) {
      return res.status(404).json({
        error: "No encontramos esa compra en tu cuenta.",
      });
    }

    if (
      Number(order.amount) !== PRODUCT_AMOUNT ||
      order.currency !== CURRENCY ||
      order.external_reference !== order.id ||
      !order.preference_id
    ) {
      return res.status(403).json({
        error: "Los datos de la compra no coinciden.",
      });
    }

    // 4. Comprobar el archivo antes de registrar la compra como pagada.
    if (
      typeof order.html_snapshot !== "string" ||
      !order.html_snapshot ||
      Buffer.byteLength(order.html_snapshot, "utf8") > 300000
    ) {
      return res.status(500).json({
        error: "El archivo de la compra no está disponible.",
      });
    }

    const calculatedHash = createHash("sha256")
      .update(order.html_snapshot, "utf8")
      .digest("hex");

    const expectedHash = Buffer.from(order.html_sha256 || "", "hex");
    const actualHash = Buffer.from(calculatedHash, "hex");

    if (
      expectedHash.length !== 32 ||
      actualHash.length !== 32 ||
      !timingSafeEqual(expectedHash, actualHash)
    ) {
      return res.status(500).json({
        error: "No pudimos verificar la integridad del archivo.",
      });
    }

    // 5. Consultar los pagos directamente en Mercado Pago.
    const searchUrl = new URL(
      "https://api.mercadopago.com/v1/payments/search"
    );
    searchUrl.searchParams.set("external_reference", order.id);
    searchUrl.searchParams.set("sort", "date_created");
    searchUrl.searchParams.set("criteria", "desc");
    searchUrl.searchParams.set("limit", "50");

    const paymentResponse = await fetch(searchUrl, {
      headers: {
        Authorization: `Bearer ${mpToken}`,
      },
    });

    if (!paymentResponse.ok) {
      return res.status(502).json({
        error: "No pudimos verificar el pago. Intentá nuevamente.",
      });
    }

    const paymentData = await paymentResponse.json();
    const payments = Array.isArray(paymentData?.results)
      ? paymentData.results
      : [];

    const payment = payments.find(
      (item) =>
        item &&
        String(item.external_reference || "") === order.id &&
        item.status === "approved" &&
        item.currency_id === CURRENCY &&
        Number(item.transaction_amount) === PRODUCT_AMOUNT &&
        String(item.id || "").length > 0 &&
        String(item.preference_id || "") === order.preference_id
    );

    if (!payment) {
      return res.status(403).json({
        error: "Mercado Pago no confirma un pago aprobado para esta compra.",
      });
    }

    // 6. Guardar el pago verificado.
    const updateUrl = new URL(`${baseUrl}/rest/v1/mw_orders`);
    updateUrl.searchParams.set("id", `eq.${order.id}`);
    updateUrl.searchParams.set("user_id", `eq.${user.id}`);

    const updateResponse = await fetch(updateUrl, {
      method: "PATCH",
      headers: {
        apikey: secretKey,
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        status: "paid",
        mp_payment_id: String(payment.id),
        updated_at: new Date().toISOString(),
      }),
    });

    if (!updateResponse.ok) {
      return res.status(500).json({
        error: "No pudimos registrar el pago verificado.",
      });
    }

    const updatedOrders = await updateResponse.json();

    if (!Array.isArray(updatedOrders) || updatedOrders.length !== 1) {
      return res.status(500).json({
        error: "No pudimos confirmar el registro de la compra.",
      });
    }

    // 7. Entregar el archivo únicamente tras verificar el pago.
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="marketweb-plantilla.html"'
    );

    return res.status(200).send(order.html_snapshot);
  } catch {
    return res.status(500).json({
      error: "Error interno al verificar la compra.",
    });
  }
}
