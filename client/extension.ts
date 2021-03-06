"use strict";

import {ChildProcess} from "child_process";
import * as getPort from "get-port";
import {Socket} from "net";
import * as path from "path";
import {Disposable, ExtensionContext, OutputChannel, window} from "vscode";
import * as lcp from "vscode-languageclient";
import {install_server, start_server, server_installed} from "./server";


let server_info: Object;

export async function activate(context: ExtensionContext) {
    let outputChannel: OutputChannel = window.createOutputChannel("YARA");
    context.subscriptions.push(outputChannel);
    // check if the server components are installed - if not, install them
    let serverRoot: string = path.join(context.extensionPath, "server");
    if (!server_installed(serverRoot)) {
        let msg: string = `Installing YARA Language Server components into ${serverRoot}`;
        outputChannel.appendLine(`[Extension Activation] ${msg}`);
        if (install_server(context.extensionPath, serverRoot)) {
            let msg: string = "Successfully installed server components";
            outputChannel.appendLine(`[Extension Activation] ${msg}`);
        }
        else {
            let msg: string = "Failed to install server components";
            outputChannel.appendLine(`[Extension Activation] ${msg}`);
            window.showErrorMessage(`YARA: ${msg}`);
        }
    }
    let lhost: string = "127.0.0.1";
    // grab a random open TCP port to listen to
    let tcpPort: number = await getPort();
    let langserver: ChildProcess = await start_server(serverRoot, lhost, tcpPort);
    // when the client starts it should open a socket to the server
    const serverOptions: lcp.ServerOptions = function() {
        return new Promise((resolve, reject) => {
            let connection: Socket = new Socket({readable: true, writable: true});
            connection.connect(tcpPort, lhost, function() {
                resolve({
                    reader: connection,
                    writer: connection
                });
            });
            connection.on("error", (error) => {
                // apparently net.Socket just rewraps errors as a generic Error object
                // kind of annoying, but workable
                if (error.message.includes("ECONNREFUSED")) {
                    let msg: string = "Could not connect to YARA Language Server. Is it running?"
                    window.showErrorMessage(msg);
                    window.setStatusBarMessage(`Not connected to YARA Language Server`);
                }
                else {
                    window.showErrorMessage(`YARA: ${error.message}`);
                }
            });
        });
    }
    // register the client for all the YARA things
    const clientOptions: lcp.LanguageClientOptions = {
        // it shouldn't matter whether the file is on-disk or not
        documentSelector: [
            {language: "yara", scheme: "file"},
            {language: "yara", scheme: "untitled"}
        ],
        diagnosticCollectionName: "yara",
        outputChannel: outputChannel,
        synchronize: {
            configurationSection: "yara",
        }
    };
    let client = new lcp.LanguageClient(
        "yara-languageclient",
        "YARA",
        serverOptions,
        clientOptions
    );
    client.info("Started YARA extension");
    client.info(`Language Server started with PID: ${langserver.pid}`);
    context.subscriptions.push(client.start());
    // kill the server's process when disposing of it
    context.subscriptions.push(new Disposable(langserver.kill));
    // save these for later accessibility
    server_info = {
        "process": langserver,
        "host": lhost,
        "port": tcpPort
    }
    // give access to the language server's process and port info
    let api = {
        get_server() {
            return server_info;
        }
    }
    return api;
}

export function deactivate(context: ExtensionContext) {
    // console.log("Deactivating Yara extension");
    context.subscriptions.forEach(disposable => {
        disposable.dispose();
    });
}
