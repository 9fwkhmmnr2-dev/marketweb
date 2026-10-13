
import { createHmac, timingSafeEqual } from "node:crypto";

function reply(res, status, body) {
  return res.status(status).json(body);
}

function safeEqual(a, b) {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length &&
    timingSafeEqual(left, right);
}

function verifySignature(req, paymentId, secret) {
  const signature = req.headers["x-signature"];
  const requestId = req.headers["x-request-id"];
  const queryId = req.query?.["data.id"];

  if (
    typeof signature !== "string" ||
    typeof requestId !== "string" ||
    (typeof queryId !== "string" &&
      typeof queryId !== "number") ||
    String(queryId).toLowerCase() !== paymentId.toLowerCase()
  ) {
    return false;
  }

  const parts = Object.fromEntries(
    signature.split(",").map((part) => {
      const index = part.indexOf("=");
      return index < 0
        ? ["", ""]
        : [
            part.slice(0, index).trim(),
            part.slice(index + 1).trim()
          ];
    })
  );

  const timestamp = parts.ts;
  const receivedHash = parts.v1;

  if (
    !timestamp ||
    !receivedHash ||
    !/^\d+$/.test(timestamp) ||
    !/^[a-f0-9]{64}$/i.test(receivedHash)
  ) {
    return false;
  }

  const manifest =
    `id:${String(queryId).toLowerCase()};` +
    `request-id:${requestId};` +
    `ts:${timestamp};`;

  const expectedHash = createHmac("sha256", secret)
    .update(manifest)
    .digest("hex");

  return safeEqual(
    receivedHash.toLowerCase(),
    expectedHash.toLowerCase()
  );
}

async function dbRequest(path, options = {}) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  const response = await fetch(
    `${base.replace(/\/$/, "")}${path}`,
    {
      ...options,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    }
  );

  if (!response.ok) {
    throw new Error("DATABASE_REQUEST_FAILED");
  }

  return response.status === 204
    ? null
    : response.json().catch(() => null);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return reply(res, 405, {
      error: "Método no permitido."
    });
  }

  const mpToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  const webhookSecret =
    process.env.MERCADOPAGO_WEBHOOK_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;

  if (!mpToken || !webhookSecret ||
      !supabaseUrl || !supabaseKey) {
    return reply(res, 500, {
      error: "Configuración incompleta."
    });
  }

  const paymentId =
    req.query?.["data.id"] ??
    req.query?.id ??
    req.body?.data?.id;

  const eventType =
    req.query?.type ||
    req.query?.topic ||
    req.body?.type;

  if (eventType && eventType !== "payment") {
    return reply(res, 200, { received: true });
  }

  if (
    (typeof paymentId !== "string" &&
      typeof paymentId !== "number") ||
    !/^\d+$/.test(String(paymentId))
  ) {
    return reply(res, 400, {
      error: "Identificador inválido."
    });
  }

  const id = String(paymentId);

  if (!verifySignature(req, id, webhookSecret)) {
    return reply(res, 401, {
      error: "Firma inválida."
    });
  }

  try {
    const mpResponse = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(id)}`,
      {
        headers: {
          Authorization: `Bearer ${mpToken}`
        }
      }
    );

    if (!mpResponse.ok) {
      return reply(res, 502, {
        error: "No se pudo verificar el pago."
      });
    }

    const payment = await mpResponse.json();

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (
      String(payment.id) !== id ||
      payment.currency_id !== "ARS" ||
      Number(payment.transaction_amount) !== 4990 ||
      typeof payment.external_reference !== "string" ||
      !uuidPattern.test(payment.external_reference) ||
      typeof payment.preference_id !== "string" ||
      !payment.preference_id
    ) {
      return reply(res, 200, { received: true });
    }

    const orderId = payment.external_reference;

    const orders = await dbRequest(
      `/rest/v1/mw_orders?id=eq.${encodeURIComponent(orderId)}` +
      "&select=id,status,amount,currency,external_reference,mp_payment_id,preference_id&limit=1"
    );

    const order = Array.isArray(orders) ? orders[0] : null;

    if (
      !order ||
      Number(order.amount) !== 4990 ||
      order.currency !== "ARS" ||
      order.external_reference !== orderId ||
      typeof order.preference_id !== "string" ||
      !order.preference_id ||
      order.preference_id !== payment.preference_id
    ) {
      return reply(res, 200, { received: true });
    }

    if (payment.status !== "approved") {
      return reply(res, 200, { received: true });
    }

    if (order.status === "paid") {
      return reply(res, 200, { received: true });
    }

    if (order.status !== "pending") {
      return reply(res, 200, { received: true });
    }

    const updated = await dbRequest(
      `/rest/v1/mw_orders?id=eq.${encodeURIComponent(orderId)}` +
      "&status=eq.pending" +
      `&preference_id=eq.${encodeURIComponent(order.preference_id)}` +
      "&select=id",
      {
        method: "PATCH",
        headers: {
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          status: "paid",
          mp_payment_id: id,
          updated_at: new Date().toISOString()
        })
      }
    );

    if (!Array.isArray(updated) || updated.length === 0) {
      return reply(res, 200, { received: true });
    }

    return reply(res, 200, { received: true });
  } catch {
    return reply(res, 500, {
      error: "Error interno al verificar el pago."
    });
  }
}
