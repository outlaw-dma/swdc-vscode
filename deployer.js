#!/usr/bin/env node
const { exec } = require("child_process");
const fs = require("fs");

const KEY_MAP = {
    "code-time": "swdc-vscode",
    "music-time": "music-time"
};

const CODE_TIME_DESC =
    "Code Time is an open source plugin that provides programming metrics right in Visual Studio Code.";
const MUSIC_TIME_DESC =
    "Music Time is an open source plugin that curates and launches playlists for coding right from your editor.";
const CODE_TIME_VERSION = "0.16.1";
const MUSIC_TIME_VERSION = "0.1.5";
const CODE_TIME_DISPLAY = "Code Time";
const MUSIC_TIME_DISPLAY = "Music Time";

// copy the scripts data to dist/scripts
async function deploy() {
    const args = process.argv;
    let key = null;
    if (args && args.length > 2) {
        const remainingArgs = args.slice(2);
        // we only care about name for now
        for (let i = 0; i < remainingArgs.length; i++) {
            let argParts = remainingArgs[i].split("=");
            if (!argParts || argParts.length !== 2) {
                // break out and show usage
                console.error(
                    "Usage: node deployer name={swdc-vscode|music-time}"
                );
                process.exit(1);
            } else {
                if (argParts[0].indexOf("name") !== -1) {
                    key = argParts[1];
                    break;
                }
            }
        }
        if (!key) {
            console.error("Usage: node deployer name=extension-name");
            process.exit(1);
        }
    }
    let pluginName = KEY_MAP[key];

    if (!pluginName) {
        console.error(
            `The plugin extension name is not found based on the key: ${key}`
        );
        console.error("Usage: node deployer name={swdc-vscode|music-time}");
        process.exit(1);
    }

    debug(`Building plugin: ${pluginName}`);

    let extInfoJson = getJsonFromFile(getExtensionFile());
    extInfoJson["name"] = pluginName;
    updateJsonContent(extInfoJson, getExtensionFile());

    let packageJson = getJsonFromFile(getPackageFile());
    packageJson["name"] = pluginName;
    if (pluginName === "swdc-vscode") {
        // remove contributes.viewsContainers and contributes.views
        if (
            packageJson.contributes &&
            packageJson.contributes.viewsContainers
        ) {
            delete packageJson.contributes.viewsContainers;
        }
        if (packageJson.contributes && packageJson.contributes.views) {
            delete packageJson.contributes.views;
        }
        packageJson["description"] = CODE_TIME_DESC;
        packageJson["version"] = CODE_TIME_VERSION;
        packageJson["displayName"] = CODE_TIME_DISPLAY;

        let codeTimeCommands = [];
        let existingCommands = packageJson.contributes["commands"];
        for (let i = 0; i < existingCommands.length; i++) {
            let commandObj = existingCommands[i];
            if (commandObj.command.indexOf("musictime.") === -1) {
                codeTimeCommands.push(commandObj);
            }
        }
        packageJson.contributes["commands"] = codeTimeCommands;
    } else if (pluginName === "music-time") {
        //
        // add the viewsContainers and views
        // packageJson.contributes["viewsContainers"] = {
        //     activitybar: [
        //         {
        //             id: "music-time",
        //             title: "Music Time",
        //             icon: "resources/dark/paw.svg"
        //         }
        //     ]
        // };
        // packageJson.contributes["views"] = {
        //     "music-time": [
        //         {
        //             id: "music-time-playlists",
        //             name: "Playlists"
        //         }
        //     ]
        // };
        packageJson["description"] = MUSIC_TIME_DESC;
        packageJson["version"] = MUSIC_TIME_VERSION;
        packageJson["displayName"] = MUSIC_TIME_DISPLAY;
        packageJson.contributes["commands"].push({
            command: "musictime.next",
            title: "Play Next Song"
        });
        packageJson.contributes["commands"].push({
            command: "musictime.previous",
            title: "Play Previous Song"
        });
        packageJson.contributes["commands"].push({
            command: "musictime.play",
            title: "Play"
        });
        packageJson.contributes["commands"].push({
            command: "musictime.pause",
            title: "Pause"
        });
        packageJson.contributes["commands"].push({
            command: "musictime.like",
            title: "Like Song"
        });
        packageJson.contributes["commands"].push({
            command: "musictime.unlike",
            title: "Unlike Song"
        });
        packageJson.contributes["commands"].push({
            command: "musictime.menu",
            title: "Click to see more from Music Time"
        });
        packageJson.contributes["commands"].push({
            command: "musictime.connectSpotify",
            title: "Connect your spotify account"
        });
        packageJson.contributes["commands"].push({
            command: "musictime.launchplayer",
            title: "Launch your music player"
        });
    }

    updateJsonContent(packageJson, getPackageFile());

    await runCommand(
        "mkdir out/lib",
        "Creating the dist/lib directory if it doesn't exist"
    );
    await runCommand(
        "cp lib/extensioninfo.json out/lib/.",
        "Copy the extensioninfo.json to the out/lib directory"
    );
}

function getExtensionFile() {
    return __dirname + "/lib/extensioninfo.json";
}

function getPackageFile() {
    return __dirname + "/package.json";
}

function getJsonFromFile(filename) {
    let content = fs.readFileSync(filename).toString();
    if (content) {
        try {
            const data = JSON.parse(content);
            return data;
        } catch (e) {
            //
        }
    }
    return null;
}

function updateJsonContent(packageJson, filename) {
    try {
        // JSON.stringify(data, replacer, number of spaces)
        const content = JSON.stringify(packageJson, null, 4);
        fs.writeFileSync(filename, content, err => {
            if (err)
                console.log(
                    "Deployer: Error updating the package content: ",
                    err.message
                );
            process.exit(1);
        });
    } catch (e) {
        //
    }
}

async function runCommand(
    cmd,
    execMsg,
    goToDirAfterExec = null,
    allowError = true
) {
    var execResult = await wrapExecPromise(cmd);
    if (goToDirAfterExec && goToDirAfterExec.length > 0) {
        cd(goToDirAfterExec);
    }

    allowError =
        allowError !== undefined && allowError !== null ? allowError : false;

    if (execResult && execResult.code !== 0 && !allowError) {
        /* error happened */
        debug(
            "Failed to " +
                execMsg +
                ", code: " +
                execResult.code +
                ", reason: " +
                execResult.stderr
        );
        process.exit(1);
    } else {
        debug("Completed task to " + execMsg + ".");
    }
}

async function wrapExecPromise(cmd, dir) {
    let result = null;
    try {
        let opts = dir !== undefined && dir !== null ? { cwd: dir } : {};
        result = await execPromise(cmd, opts);
    } catch (e) {
        result = null;
    }
    return result;
}

function execPromise(command, opts) {
    return new Promise(function(resolve, reject) {
        exec(command, opts, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(stdout.trim());
        });
    });
}

function debug(message) {
    console.log("-- " + message + "\n");
}

deploy();
