/* Countdown for a form the CRM says was sent too recently (retryAfterSeconds).
   Plain functions with no page access, so scripts/check_retry_countdown.js runs
   them in Node. In the browser they are window.BYMRetry (assets/forms.js). */
(function (root) {
  "use strict";

  // "You asked for this report a few minutes ago. You can ask again in 14 minutes."
  function message(remainingSeconds) {
    var minutes = Math.ceil(remainingSeconds / 60);
    var wait = remainingSeconds <= 60 ? "less than a minute" : minutes + " minutes";
    return "You asked for this report a few minutes ago. You can ask again in " + wait + ".";
  }

  // Counts down from `seconds` and calls hooks.onTick(text) when the shown
  // text changes (at most once a minute, so a screen reader is not flooded)
  // and hooks.onDone() once. env supplies now(), setInterval and clearInterval
  // (the browser's, or fakes). Returns { stop }.
  function start(seconds, hooks, env) {
    var deadline = env.now() + seconds * 1000;
    var shown = null;
    var finished = false;
    var timer = null;

    function tick() {
      if (finished) return;
      var left = Math.ceil((deadline - env.now()) / 1000);
      if (left <= 0) {
        finished = true;
        env.clearInterval(timer);
        hooks.onDone();
        return;
      }
      var text = message(left);
      if (text !== shown) {
        shown = text;
        hooks.onTick(text);
      }
    }

    tick();
    if (!finished) timer = env.setInterval(tick, 1000);
    return {
      stop: function () {
        finished = true;
        env.clearInterval(timer);
      }
    };
  }

  var api = { message: message, start: start };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BYMRetry = api;
})(typeof window !== "undefined" ? window : this);
