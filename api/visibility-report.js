const { submitLead } = require("./_lead");

module.exports = (req, res) => submitLead(req, res, { crmForm: "visibility-report" });
