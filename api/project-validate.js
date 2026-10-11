
const crypto = require("crypto");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  const { title, html } = req.body || {};

  if (
    typeof title !== "string" ||
    typeof html !== "string"
  ) {
    return res.status(400).json({
      ok: false,
      error: "Faltan el título o el HTML"
    });
  }

  const cleanTitle = title.trim();
  const cleanHtml = html.trim();

  if (!cleanTitle || cleanTitle.length > 80) {
    return res.status(400).json({
      ok: false,
      error: "El título debe tener entre 1 y 80 caracteres"
    });
  }

  if (
    !cleanHtml ||
    Buffer.byteLength(cleanHtml, "utf8") > 300000
  ) {
    return res.status(400).json({
      ok: false,
      error: "El HTML está vacío o supera los 300 KB"
    });
  }

  if (!/<html(?:\s|>)/i.test(cleanHtml)) {
    return res.status(400).json({
      ok: false,
      error: "El documento HTML no contiene una etiqueta html válida"
    });
  }

  const sha256 = crypto
    .createHash("sha256")
    .update(cleanHtml, "utf8")
    .digest("hex");

  return res.status(200).json({
    ok: true,
    title: cleanTitle,
    sizeBytes: Buffer.byteLength(cleanHtml, "utf8"),
    sha256
  });
};
