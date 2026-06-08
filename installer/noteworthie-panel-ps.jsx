// noteworthie-panel-ps.jsx — Noteworthie pipeline launcher for Photoshop.
// Installed into Photoshop's File > Scripts menu by install.command.
// Artist runs: File > Scripts > Noteworthie → a dialog lists the pipelines as
// buttons. Clicking one closes the dialog and runs that pipeline.
//
// Modal dialog (not a floating panel) for the same reason as the Illustrator
// launcher: a robust, version-proof launcher that needs no startup-script hook.
#target photoshop

var SCRIPTS_DIR = (new File("~")).fsName
    + "/Library/Application Support/Noteworthie/scripts/pipelines";

var PIPELINES = [
    { name: "1 · Build Elements",          file: "PS_BuildElements.jsx" },
    { name: "2 · Build & Export Cutlines", file: "PSAI_BuildAndExportCutlines.jsx" }
];

function runPipeline(p) {
    var f = new File(SCRIPTS_DIR + "/" + p.file);
    if (!f.exists) {
        alert("Script not found:\n" + f.fsName
            + "\n\nMake sure the Noteworthie installer has run at least once.");
        return;
    }
    try {
        $.evalFile(f);
    } catch (e) {
        alert("Error running " + p.name + ":\n" + e.message + " (line " + e.line + ")");
    }
}

function choosePipeline() {
    var win = new Window("dialog", "Noteworthie", undefined, { resizeable: false });
    win.alignChildren = "fill";
    win.spacing = 6;
    win.margins = 16;

    win.add("statictext", undefined, "Run a pipeline:");

    var chosen = null;
    for (var i = 0; i < PIPELINES.length; i++) {
        (function (p) {
            var btn = win.add("button", undefined, p.name);
            btn.onClick = function () { chosen = p; win.close(); };
        })(PIPELINES[i]);
    }

    win.add("button", undefined, "Cancel", { name: "cancel" });
    win.center();
    win.show();
    return chosen;
}

var pick = choosePipeline();
if (pick) runPipeline(pick);
