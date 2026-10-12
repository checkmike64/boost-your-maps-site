const { submitLead } = require("./_lead");

module.exports = (req, res) => submitLead(req, res, { tag: "inquiry", source: "Website - Contact Form", crmForm: "inquiry" });
