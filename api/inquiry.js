const { submitToGhl } = require("./_ghl");

module.exports = (req, res) => submitToGhl(req, res, { tag: "inquiry", source: "Website - Contact Form" });
