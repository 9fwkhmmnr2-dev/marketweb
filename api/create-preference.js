
const crypto = require("crypto");

const PRICE_ARS = 4990;
const PRODUCT_TYPE = "basica";
const MAX_HTML_BYTES = 300000;

const PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_6wS64xCMk4_073N2xbLJ4Q_1GYzALcq";

function sendError(res, status, message) {
  return res.status(status).json({ ok: false, error: message });
}

function getAppUrl() {
  const value = process.env.APP_URL;
  if (!value) throw new Error("Falta configurar APP_URL.");

  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("APP_URL debe ser una URL HTTPS válida.");
  }

  return url.origin;
}

async function supabaseAdmin(path, options = {}) {
  const base = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;

  if (!base || !secret) {
    throw new Error("Falta configurar Supabase en el servidor.");
  }

  return fetch(`${base.replace(/\/+$/, "")}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendError(res, 405, "Método no permitido.");
  }

  try {
    const mpToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    const supabaseUrl = process.env.SUPABASE_URL;

    if (!mpToken || !supabaseUrl || !process.env.SUPABASE_SECRET_KEY) {
      return sendError(res, 503, "El servicio de pagos no está configurado.");
    }

    const authHeader = req.headers.authorization || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      return sendError(res, 401, "Iniciá sesión para continuar.");
    }

    const accessToken = match[1];

    // Verificar el token con Supabase Auth.
    const authResponse = await fetch(
      `${supabaseUrl.replace(/\/+$/, "")}/auth/v1/user`,
      {
        headers: {
          apikey: PUBLISHABLE_KEY,
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    if (!authResponse.ok) {
      return sendError(res, 401, "La sesión no es válida o venció.");
    }

    const user = await authResponse.json();

    if (!user || !user.id) {
      return sendError(res, 401, "No se pudo verificar el usuario.");
    }

    const body = req.body || {};
    const projectId = body.projectId;

    if (
      typeof projectId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)
    ) {
      return sendError(res, 400, "El identificador del proyecto no es válido.");
    }

    // Obtener el proyecto únicamente si pertenece al usuario autenticado.
    const projectQuery = new URLSearchParams({
      select: "id,user_id,title,html",
      id: `eq.${projectId}`,
      user_id: `eq.${user.id}`,
      limit: "1"
    });

    const projectResponse = await supabaseAdmin(
      `mw_projects?${projectQuery.toString()}`
    );

    if (!projectResponse.ok) {
      return sendError(res, 502, "No se pudo consultar el proyecto guardado.");
    }

    const projects = await projectResponse.json();
    const project = projects[0];

    if (!project) {
      return sendError(res, 404, "El proyecto no existe o no te pertenece.");
    }

    if (typeof project.html !== "string" || !project.html.trim()) {
      return sendError(res, 400, "El proyecto no contiene HTML guardado.");
    }

    if (Buffer.byteLength(project.html, "utf8") > MAX_HTML_BYTES) {
      return sendError(res, 400, "El HTML guardado supera el límite permitido.");
    }

    // El hash se calcula en el servidor a partir del HTML guardado.
    const html = project.html;
    const htmlSha256 = crypto
      .createHash("sha256")
      .update(html, "utf8")
      .digest("hex");

    // El cliente no puede elegir el precio ni el tipo de producto.
    const orderResponse = await supabaseAdmin("mw_orders", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        product_type: PRODUCT_TYPE,
        status: "pending",
        title: project.title,
        amount: PRICE_ARS,
        currency: "ARS",
        html_sha256: htmlSha256,
        external_reference: crypto.randomUUID(),
        user_id: user.id,
        project_id: project.id,
        html_snapshot: html
      })
    });

    if (!orderResponse.ok) {
      return sendError(res, 502, "No se pudo registrar el pedido.");
    }

    const createdOrders = await orderResponse.json();
    const order = createdOrders[0];

    if (!order || !order.id) {
      return sendError(res, 502, "No se recibió el pedido creado.");
    }

    const appUrl = getAppUrl();

    const preferenceResponse = await fetch(
      "https://api.mercadopago.com/checkout/preferences",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${mpToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          items: [
            {
              id: "marketweb-barberia-basica",
              title: `MarketWeb — ${project.title}`,
              quantity: 1,
              currency_id: "ARS",
              unit_price: PRICE_ARS
            }
          ],
          external_reference: order.id,
          notification_url: `${appUrl}/api/payment-webhook`,
          back_urls: {
            success: `${appUrl}/?payment=success`,
            pending: `${appUrl}/?payment=pending`,
            failure: `${appUrl}/?payment=failure`
          },
          auto_return: "approved"
        })
      }
    );

    const preference = await preferenceResponse.json();

    if (
      !preferenceResponse.ok ||
      !preference.id ||
      !(preference.sandbox_init_point || preference.init_point)
    ) {
      // No se borra el pedido: queda registrado para auditoría.
      await supabaseAdmin(`mw_orders?id=eq.${order.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "preference_error" })
      });

      return sendError(res, 502, "Mercado Pago no pudo crear el checkout.");
    }

    const updateResponse = await supabaseAdmin(
      `mw_orders?id=eq.${order.id}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ preference_id: String(preference.id) })
      }
    );

    if (!updateResponse.ok) {
      return sendError(
        res,
        502,
        "Se creó el checkout, pero no se pudo guardar su referencia. No vuelvas a pagar; revisá el pedido."
      );
    }

    return res.status(200).json({
      ok: true,
      orderId: order.id,
      checkoutUrl: preference.sandbox_init_point || preference.init_point
    });
  } catch (error) {
    // No devolver tokens, cabeceras ni detalles internos al navegador.
    console.error("create-preference error:", error.message);
    return sendError(res, 500, "No se pudo iniciar el pago.");
  }
};
