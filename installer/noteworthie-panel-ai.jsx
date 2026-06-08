// noteworthie-panel-ai.jsx — Noteworthie pipeline launcher for Illustrator.
// Installed into Illustrator's File > Scripts menu by install.command.
// Artist runs: File > Scripts > Noteworthie → a dialog lists the pipelines as
// buttons. Clicking one closes the dialog and runs that pipeline.
//
// Why a modal dialog and not a floating panel: Illustrator garbage-collects
// ScriptUI "palette" windows the moment a Scripts-menu script returns, so a
// floating panel only persists if installed as a startup script. The modal
// dialog is the robust, version-proof launcher.
#target illustrator

var SCRIPTS_DIR = (new File("~")).fsName
    + "/Library/Application Support/Noteworthie/scripts/pipelines";

var PIPELINES = [
    { name: "3 · Import Nesting",  file: "AI_ImportNesting.jsx" },
    { name: "4 · Refine Cutlines", file: "AI_RefineCutlines.jsx" },
    { name: "5 · Export Final",    file: "AI_ExportFinal.jsx" },
    { name: "6 · Nesting QA",      file: "AI_NestingQA.jsx" }
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
