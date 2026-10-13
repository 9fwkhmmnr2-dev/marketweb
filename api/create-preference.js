
import { createHash, randomUUID } from "node:crypto";

const ALLOWED_METHOD = "POST";
const PRODUCT_AMOUNT = 4990;
const PRODUCT_TYPE = "basica";
const CURRENCY = "ARS";

function json(res, status, body) {
  return res.status(status).json(body);
}

function getBearerToken(req) {
  const value = req.headers.authorization || "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

async function supabaseRequest(path, options = {}) {
  const baseUrl = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;

  if (!baseUrl || !secret) {
    throw new Error("SERVER_CONFIG");
  }

  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}${path}`,
    {
      ...options,
      headers: {
        apikey: secret,
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    }
  );

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error("SUPABASE_REQUEST_FAILED");
  }

  return data;
}

export default async function handler(req, res) {
  if (req.method !== ALLOWED_METHOD) {
    res.setHeader("Allow", ALLOWED_METHOD);
    return json(res, 405, { error: "Método no permitido." });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecret = process.env.SUPABASE_SECRET_KEY;
  const mpToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  const appUrl = process.env.APP_URL;

  if (!supabaseUrl || !supabaseSecret || !mpToken || !appUrl) {
    return json(res, 500, {
      error: "Falta configurar una variable del servidor.",
    });
  }

  const accessToken = getBearerToken(req);

  if (!accessToken) {
    return json(res, 401, { error: "Iniciá sesión para continuar." });
  }

  try {
    // Validar la sesión directamente con Supabase Auth.
    const userResponse = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`,
      {
        headers: {
          apikey: supabaseSecret,
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!userResponse.ok) {
      return json(res, 401, {
        error: "La sesión venció. Volvé a iniciar sesión.",
      });
    }

    const user = await userResponse.json();

    if (!user?.id) {
      return json(res, 401, { error: "Sesión inválida." });
    }

    const projectId = req.body?.projectId;

    if (
      typeof projectId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)
    ) {
      return json(res, 400, { error: "Proyecto inválido." });
    }

    // Solo permite comprar un proyecto perteneciente al usuario autenticado.
    const projects = await supabaseRequest(
      `/rest/v1/mw_projects?id=eq.${encodeURIComponent(projectId)}` +
      `&user_id=eq.${encodeURIComponent(user.id)}` +
      "&select=id,title,html&limit=1"
    );

    const project = Array.isArray(projects) ? projects[0] : null;

    if (
      !project ||
      typeof project.html !== "string" ||
      !project.html.trim()
    ) {
      return json(res, 404, {
        error: "No encontramos un proyecto guardado válido. Guardalo e intentá de nuevo.",
      });
    }

    if (Buffer.byteLength(project.html, "utf8") > 300000) {
      return json(res, 400, {
        error: "El proyecto supera el tamaño permitido.",
      });
    }

    const orderId = randomUUID();
    const now = new Date().toISOString();
    const title =
      typeof project.title === "string" && project.title.trim()
        ? project.title.trim().slice(0, 150)
        : "Plantilla MarketWeb Básica";

    const htmlHash = createHash("sha256")
      .update(project.html, "utf8")
      .digest("hex");

    // Crear la orden pendiente antes de solicitar el checkout.
    await supabaseRequest("/rest/v1/mw_orders", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: orderId,
        product_type: PRODUCT_TYPE,
        status: "pending",
        title,
        amount: PRODUCT_AMOUNT,
        currency: CURRENCY,
        html_sha256: htmlHash,
        external_reference: orderId,
        created_at: now,
        updated_at: now,
        user_id: user.id,
        project_id: project.id,
        html_snapshot: project.html,
      }),
    });

    const appBase = appUrl.replace(/\/+$/, "");

    let preferenceResponse;

    try {
      preferenceResponse = await fetch(
        "https://api.mercadopago.com/checkout/preferences",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${mpToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            items: [
              {
                id: `marketweb-${PRODUCT_TYPE}`,
                title: `MarketWeb - ${title}`,
                quantity: 1,
                currency_id: CURRENCY,
                unit_price: PRODUCT_AMOUNT,
              },
            ],
            external_reference: orderId,

back_urls: {
  success: `${appBase}/payment-return.html`,
  pending: `${appBase}/payment-return.html`,
  failure: `${appBase}/payment-return.html`,
},

auto_return: "approved",

notification_url: `${appBase}/api/payment-webhook`,
          }),
        }
      );
    } catch {
      return json(res, 502, {
        error: "No pudimos conectar con Mercado Pago. Intentá nuevamente.",
      });
    }

    const preference = await preferenceResponse.json().catch(() => null);

    if (
      !preferenceResponse.ok ||
      !preference?.id ||
      typeof preference.init_point !== "string" ||
      !preference.init_point.startsWith("https://")
    ) {
      return json(res, 502, {
        error: "Mercado Pago no pudo crear el checkout.",
      });
    }

    await supabaseRequest(
      `/rest/v1/mw_orders?id=eq.${encodeURIComponent(orderId)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          preference_id: preference.id,
          updated_at: new Date().toISOString(),
        }),
      }
    );

    return json(res, 200, {
  init_point: preference.init_point,
  preference_id: preference.id,
  order_id: orderId,
});

} catch (error) {
  console.error(
    "CREATE_PREFERENCE_ERROR:",
    error?.message || "UNKNOWN_ERROR"
  );

  return json(res, 500, {
    error: "No pudimos preparar el pago. Revisá los registros del servidor.",
  });
}
