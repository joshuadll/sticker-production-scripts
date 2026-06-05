// json2.jsx — minimal JSON.stringify / JSON.parse polyfill for ExtendScript (ES3).
// ExtendScript in Photoshop/Illustrator has no native JSON object, so the PS→AI
// sidecar contract (_elements.json) needs this. #included by the pipelines that
// read or write the sidecar (PSAI_BuildAndExportCutlines, AI_BuildCutlines).
//
// stringify: recursive encoder for the value types we actually serialise
//   (object, array, string, finite number, boolean, null). Functions/undefined
//   are omitted (object) or rendered null (array), matching standard JSON.
// parse: Douglas Crockford's four-stage regexp sanity check followed by eval —
//   public-domain technique. Safe because the text is rejected unless it contains
//   only JSON-legal tokens, so eval cannot execute arbitrary code.
//
// The escapable regex is built via new RegExp from an all-ASCII pattern string so
// no literal control bytes land in this file (a NUL byte breaks #include). Only
// control chars (U+0000–001F, U+007F–009F) plus quote/backslash are escaped;
// printable unicode (e.g. accented caption text) stays raw, which JSON permits.
//
// Idempotent: guarded so multiple #includes don't clobber a real JSON if present.

if (typeof JSON !== "object") { JSON = {}; }

(function () {
    var escapable = new RegExp("[\\\\\\\"\\u0000-\\u001f\\u007f-\\u009f]", "g");
    var meta = {
        "\b": "\\b", "\t": "\\t", "\n": "\\n", "\f": "\\f", "\r": "\\r",
        "\"": "\\\"", "\\": "\\\\"
    };

    function quote(string) {
        escapable.lastIndex = 0;
        if (!escapable.test(string)) { return "\"" + string + "\""; }
        return "\"" + string.replace(escapable, function (a) {
            var c = meta[a];
            if (typeof c === "string") { return c; }
            return "\\u" + ("0000" + a.charCodeAt(0).toString(16)).slice(-4);
        }) + "\"";
    }

    function str(value) {
        var i, partial, k, v;

        switch (typeof value) {
        case "string":
            return quote(value);
        case "number":
            return isFinite(value) ? String(value) : "null";
        case "boolean":
            return String(value);
        case "object":
            if (!value) { return "null"; }
            partial = [];
            if (Object.prototype.toString.apply(value) === "[object Array]") {
                for (i = 0; i < value.length; i += 1) {
                    partial[i] = str(value[i]);
                    if (partial[i] === undefined) { partial[i] = "null"; }
                }
                return "[" + partial.join(",") + "]";
            }
            for (k in value) {
                if (Object.prototype.hasOwnProperty.call(value, k)) {
                    v = str(value[k]);
                    if (v !== undefined) { partial.push(quote(k) + ":" + v); }
                }
            }
            return "{" + partial.join(",") + "}";
        }
        return undefined; // function, undefined
    }

    if (typeof JSON.stringify !== "function") {
        JSON.stringify = function (value) { return str(value); };
    }

    if (typeof JSON.parse !== "function") {
        JSON.parse = function (text) {
            var t = String(text);
            if (/^[\],:{}\s]*$/.test(
                    t.replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, "@")
                     .replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, "]")
                     .replace(/(?:^|:|,)(?:\s*\[)+/g, ""))) {
                return eval("(" + t + ")");
            }
            throw new SyntaxError("JSON.parse: malformed input");
        };
    }
}());
