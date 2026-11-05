const pool = require("../db/db");
const {
  LayoutError,
  normalizeLayout,
  loadReportLayout,
  saveReportLayout,
  resetReportLayout,
} = require("../lib/reportLayout");

// GET /api/report-layout → { layout, isDefault }
const getReportLayout = async (req, res) => {
  try {
    res.json(await loadReportLayout(pool));
  } catch (e) {
    console.error("getReportLayout error:", e);
    res.status(500).json({ error: "internal" });
  }
};

// PUT /api/report-layout  body: { layout } → { layout, isDefault: false }
const putReportLayout = async (req, res) => {
  let layout;
  try {
    layout = normalizeLayout(req.body?.layout);
  } catch (e) {
    if (!(e instanceof LayoutError)) console.error("normalizeLayout error:", e);
    return res.status(400).json({ error: e instanceof LayoutError ? e.message : "レイアウトが不正です" });
  }
  try {
    await saveReportLayout(pool, layout);
    res.json({ layout, isDefault: false });
  } catch (e) {
    console.error("putReportLayout error:", e);
    const missingTable = e.code === "42P01";
    res.status(500).json({
      error: missingTable ? "report_layout テーブルがありません（npm run migrate を実行してください）" : "internal",
    });
  }
};

// DELETE /api/report-layout → back to the default layout
const deleteReportLayout = async (req, res) => {
  try {
    await resetReportLayout(pool);
    res.json(await loadReportLayout(pool));
  } catch (e) {
    console.error("deleteReportLayout error:", e);
    res.status(500).json({ error: "internal" });
  }
};

module.exports = { getReportLayout, putReportLayout, deleteReportLayout };
