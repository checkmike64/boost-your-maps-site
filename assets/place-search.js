/* Business search for the visibility report form (/visibility-report).
   Turns on only when /api/places says search is set up. The page calls only
   this site's /api/places (the Google key stays on the server). Picking a
   result fills two hidden fields, place_id and place_label, which assets/forms.js
   sends with the lead. Everything here is optional: with no JavaScript, with
   search off or down, the typed business name and town still go through. */
(function () {
  "use strict";

  var input = document.querySelector("[data-place-search]");
  if (!input) return;
  var form = input.form;
  var idField = form.elements.place_id;
  var labelField = form.elements.place_label;
  var list = document.getElementById("place-results");
  var note = document.getElementById("place-note");
  if (!idField || !labelField || !list || !note) return;

  var timer = null;
  var seq = 0;
  var places = [];
  var active = -1;

  function say(text) { note.textContent = text; note.hidden = !text; }

  function clearPick() {
    idField.value = "";
    labelField.value = "";
  }

  function close() {
    list.hidden = true;
    list.textContent = "";
    places = [];
    active = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  function choose(place) {
    input.value = place.name;
    idField.value = place.placeId;
    labelField.value = place.address ? place.name + ", " + place.address : place.name;
    close();
    say("Picked: " + labelField.value + ". Not right? Keep typing to change it.");
    // The town field is filled from the address only when it is still empty.
    var location = form.elements.location;
    if (location && !location.value && place.address) {
      var parts = place.address.split(",").map(function (p) { return p.trim(); });
      location.value = parts.length > 1 ? parts.slice(-2).join(", ") : parts[0];
    }
  }

  function highlight(next) {
    var items = list.children;
    if (!items.length) return;
    active = (next + items.length) % items.length;
    for (var i = 0; i < items.length; i++) items[i].setAttribute("aria-selected", i === active ? "true" : "false");
    input.setAttribute("aria-activedescendant", items[active].id);
  }

  function show(found) {
    list.textContent = "";
    places = found;
    found.forEach(function (place, i) {
      var li = document.createElement("li");
      li.id = "place-opt-" + i;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", "false");
      var strong = document.createElement("strong");
      strong.textContent = place.name;
      li.appendChild(strong);
      if (place.address) {
        var small = document.createElement("span");
        small.textContent = place.address;
        li.appendChild(small);
      }
      // mousedown, so the pick lands before the input loses focus.
      li.addEventListener("mousedown", function (ev) { ev.preventDefault(); choose(place); });
      list.appendChild(li);
    });
    list.hidden = !found.length;
    input.setAttribute("aria-expanded", found.length ? "true" : "false");
    active = -1;
  }

  async function search(q, mine) {
    try {
      var response = await fetch("/api/places", {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ q: q }),
        credentials: "omit"
      });
      var data = await response.json().catch(function () { return null; });
      if (mine !== seq) return;
      if (!response.ok || !data || !Array.isArray(data.places)) return close();
      show(data.places);
    } catch (e) {
      if (mine === seq) close(); // search is down: the form works without it
    }
  }

  input.addEventListener("input", function () {
    clearPick();
    say("");
    window.clearTimeout(timer);
    var q = input.value.trim();
    seq += 1;
    if (q.length < 3) return close();
    var mine = seq;
    timer = window.setTimeout(function () { search(q, mine); }, 350);
  });

  input.addEventListener("keydown", function (ev) {
    if (list.hidden) return;
    if (ev.key === "ArrowDown") { ev.preventDefault(); highlight(active + 1); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); highlight(active - 1); }
    else if (ev.key === "Enter" && active >= 0) { ev.preventDefault(); choose(places[active]); }
    else if (ev.key === "Escape") { close(); }
  });

  input.addEventListener("blur", function () { window.setTimeout(close, 120); });

  // assets/forms.js calls this after a sent form is reset.
  form.resetPlace = function () { clearPick(); say(""); close(); };

  // Turn the search on only when the server says it is set up.
  fetch("/api/places", { headers: { "Accept": "application/json" }, credentials: "omit" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data || data.enabled !== true) return;
      input.setAttribute("role", "combobox");
      input.setAttribute("aria-autocomplete", "list");
      input.setAttribute("aria-expanded", "false");
      input.setAttribute("aria-controls", "place-results");
      input.setAttribute("autocomplete", "off");
      input.placeholder = "Start typing, then pick your business";
    })
    .catch(function () {});
})();
