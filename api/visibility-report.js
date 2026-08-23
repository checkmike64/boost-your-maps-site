const { submitToGhl } = require("./_ghl");

module.exports = (req, res) => submitToGhl(req, res, { tag: "rank report", source: "Website - Visibility Report" });
