
module.exports = async (req, res) => {
  return res.status(200).json({
    ok: true,
    service: "marketWeb",
    test: "storage-check funciona"
  });
};
