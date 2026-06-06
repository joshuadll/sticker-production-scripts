// generate-ai-actions.jsx
// Run once in Illustrator via File > Scripts > Noteworthie Setup AI
// Creates the Noteworthie action set in the Actions panel.
// Re-run only if a new pipeline is added.
#target illustrator

var ACTION_SET = "Noteworthie";
var SCRIPTS_DIR = (new File("~")).fsName
    + "/Library/Application Support/Noteworthie/scripts/pipelines";

var PIPELINES = [
    { name: "3 · Import Nesting",    file: "AI_ImportNesting.jsx" },
    { name: "4 · Refine Cutlines",   file: "AI_RefineCutlines.jsx" },
    { name: "5 · Export Final",      file: "AI_ExportFinal.jsx" },
    { name: "6 · Nesting QA",        file: "AI_NestingQA.jsx" }
];

function main() {
    $.global.__noteworthieSetup = true;

    try {
        deleteExistingSet();
        createActionSet();
        for (var i = 0; i < PIPELINES.length; i++) {
            recordAction(PIPELINES[i].name, SCRIPTS_DIR + "/" + PIPELINES[i].file);
        }
        alert("Noteworthie actions created.\n\nOpen Window → Actions to see them.\nThey will load automatically on every Illustrator launch.");
    } catch (e) {
        alert("Error: " + e.message + " (line " + e.line + ")");
    } finally {
        $.global.__noteworthieSetup = false;
    }
}

function deleteExistingSet() {
    try {
        var ref = new ActionReference();
        ref.putName(stringIDToTypeID("actionSet"), ACTION_SET);
        var desc = new ActionDescriptor();
        desc.putReference(charIDToTypeID("null"), ref);
        executeAction(charIDToTypeID("Dlt "), desc, DialogModes.NO);
    } catch (e) { /* didn't exist, fine */ }
}

function createActionSet() {
    var desc = new ActionDescriptor();
    desc.putString(charIDToTypeID("Nm  "), ACTION_SET);
    desc.putInteger(charIDToTypeID("At  "), 1);
    executeAction(stringIDToTypeID("newActionSet"), desc, DialogModes.NO);
}

function recordAction(actionName, scriptPath) {
    // Create action and enter recording mode
    var desc = new ActionDescriptor();
    desc.putString(charIDToTypeID("Nm  "), actionName);
    desc.putInteger(charIDToTypeID("At  "), 1);
    var ref = new ActionReference();
    ref.putName(stringIDToTypeID("actionSet"), ACTION_SET);
    desc.putReference(charIDToTypeID("In  "), ref);
    executeAction(stringIDToTypeID("newAction"), desc, DialogModes.NO);

    // Record the pipeline as a "run script" step — exits immediately because
    // $.global.__noteworthieSetup guard is set
    app.doScript(new File(scriptPath), ScriptLanguage.JAVASCRIPT);

    // Stop recording
    executeAction(stringIDToTypeID("stopRecordingAction"), new ActionDescriptor(), DialogModes.NO);
}

main();
