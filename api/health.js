
module.exports = (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  res.status(200).json({
    ok: true,
    service: "marketWeb",
    message: "Backend funcionando"
  });
};
