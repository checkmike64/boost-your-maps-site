const { submitLead } = require("./_lead");

module.exports = (req, res) => submitLead(req, res, { tag: "rank report", source: "Website - Visibility Report", crmForm: "visibility-report" });
