// generate-ps-actions.jsx
// Run once in Photoshop via File > Scripts > Noteworthie Setup PS
// Creates the Noteworthie action set in the Actions panel.
// Re-run only if a new pipeline is added.
#target photoshop

var ACTION_SET = "Noteworthie";
var SCRIPTS_DIR = (new File("~")).fsName
    + "/Library/Application Support/Noteworthie/scripts/pipelines";

var PIPELINES = [
    { name: "1 · Build Elements",          file: "PS_BuildElements.jsx" },
    { name: "2 · Build & Export Cutlines",  file: "PSAI_BuildAndExportCutlines.jsx" }
];

function main() {
    $.global.__noteworthieSetup = true;
    app.playbackDisplayDialogs = DialogModes.NO;

    try {
        deleteExistingSet();
        createActionSet();
        for (var i = 0; i < PIPELINES.length; i++) {
            recordAction(PIPELINES[i].name, SCRIPTS_DIR + "/" + PIPELINES[i].file);
        }
        alert("Noteworthie actions created.\n\nOpen Window → Actions to see them.\nThey will load automatically on every Photoshop launch.");
    } catch (e) {
        alert("Error: " + e.message + " (line " + e.line + ")");
    } finally {
        $.global.__noteworthieSetup = false;
        app.playbackDisplayDialogs = DialogModes.ERROR;
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

    // Record a "run script file" step — script runs but exits immediately
    // because $.global.__noteworthieSetup is true (guard in each pipeline's main())
    var scriptDesc = new ActionDescriptor();
    scriptDesc.putPath(charIDToTypeID("null"), new File(scriptPath));
    scriptDesc.putString(charIDToTypeID("jsCo"), "");
    executeAction(stringIDToTypeID("AdobeScriptAutomation Scripts"), scriptDesc, DialogModes.NO);

    // Stop recording
    executeAction(stringIDToTypeID("stopRecordingAction"), new ActionDescriptor(), DialogModes.NO);
}

main();
