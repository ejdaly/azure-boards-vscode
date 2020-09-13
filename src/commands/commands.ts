// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See LICENSE in the project root for license information.

import * as vscode from "vscode";
import { GitExtension } from "../externals/git";
import { trackTelemetryEvent } from "../util/telemetry";

import {
  getCurrentOrganization,
  getCurrentProject,
  getCurrentRepo,
  getCurrentUser,
  getBranchPrefix
} from "../configuration/configuration";
import { getWebApiForOrganization } from "../connection";

export const enum Commands {
  WorkItemOpen = "azure-boards.open-work-item",
  Refresh = "azure-boards.refresh",
  WorkItemCreate = "azure-boards.create-work-item",
  WorkItemMention = "azure-boards.mention-work-item",
  CheckoutBranch = "azure-boards.checkout-branch",
  WorkItemPreview = "azure-boards.preview-work-item",
  SettingsShow = "azure-boards.settings.show"
}

export function registerGlobalCommands(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.WorkItemOpen, args => {
      const editUrl = args.editUrl || args;

      //track edit work item telemetry event
      trackTelemetryEvent(Commands.WorkItemOpen);

      vscode.commands.executeCommand("vscode.open", vscode.Uri.parse(editUrl));
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(Commands.WorkItemCreate, async () => {
      const currentOrganization = getCurrentOrganization();
      if (!currentOrganization) return;
      const currentProject = getCurrentProject();
      if (!currentProject) return;

      // TODO: these are hardcoded...
      //
      // @ts-ignore
      let [type] = await vscode.window.showQuickPick(['Bug', 'Issue', 'Epic', 'Feature', 'Story', 'Task'], {
        prompt: "Work Item Type",
        canPickMany: false
      });
      if (!type) return;

      const title = await vscode.window.showInputBox({
        prompt: "Enter title"
      });
      if (!title) return;

      const description = await vscode.window.showInputBox({
        prompt: "Enter Description (Optional)"
      });

      const webApi = await getWebApiForOrganization(currentOrganization);
      const witApi = await webApi.getWorkItemTrackingApi();

      await witApi.createWorkItem(null, [{
        "op": "add",
        "path": `/fields/System.Title`,
        "value": title
      }, {
        "op": "add",
        "path": `/fields/System.Description`,
        "value": description
      }], currentProject.id, type);

      await vscode.commands.executeCommand(Commands.Refresh);
    })
  );

  // This is called when you click a work item
  // TODO: when you update a work item, the tree will update here, but the webview
  // will not
  // If you just click the same link again it will work, but should happen automatically...
  //

  // reference to the webview
  //
  // @ts-ignore
  var panel = null;
  vscode.commands.registerCommand(Commands.WorkItemPreview, async args => {

    // @ts-ignore
    if (!panel) {

      panel = vscode.window.createWebviewPanel(
        'azure-boards-preview', // Identifies the type of the webview. Used internally
        'Azure Boards Preview', // Title of the panel displayed to the user
        vscode.ViewColumn.One, // Editor column to show the new webview panel in.
        {
          enableScripts: true
        }
      );

      // Just unset the panel variable when we close the tab
      // Should probably clean up listenters etc.., but maybe it cleans up that itself..?
      //
      panel.onDidDispose(
        () => {
          panel = null
        },
        null,
        context.subscriptions
      );

      // TODO: if any of the config settings are missing, this will just fail silent..
      //
      const currentOrganization = getCurrentOrganization();
      if (!currentOrganization) return;

      const currentProject = getCurrentProject();
      if (!currentProject) return;

      const currentRepo = getCurrentRepo();
      if (!currentRepo) return;

      const currentUser = getCurrentUser();
      if (!currentUser) return;

      const branchPrefix = getBranchPrefix();

      const webApi = await getWebApiForOrganization(currentOrganization);
      const witApi = await webApi.getWorkItemTrackingApi();

      panel.webview.onDidReceiveMessage(
        async message => {
          let { action, field, id, value } = message;

          // Start a Work Item
          //
          if (action === "startWork") {
            const gitExtension = vscode.extensions.getExtension<GitExtension>(
              "vscode.git"
            );
            if (!gitExtension) return;
            const git = gitExtension.exports.getAPI(1);
            if (git.repositories.length) {
              const repo = git.repositories[0];

              try {
                await repo.fetch();
              } catch (err) {
                vscode.window.showErrorMessage(err.stderr);
                return;
              }
              // vscode.window.showInformationMessage("git fetch");

              try {
                await repo.checkout(value);
              } catch (err) {
                console.log(err);
                vscode.window.showErrorMessage(err.stderr);
                return;
              }
              // vscode.window.showInformationMessage(`git checkout ${value}`);

              try {
                await repo.pull();
              } catch (err) {
                console.log(err);
                vscode.window.showErrorMessage(err.stderr);
                return;
              }
              // vscode.window.showInformationMessage(`git pull`);

              try {

                // Doesn't seem to be a rebase API method for either of our Git APIs
                // So, just spawn a process...
                //
                const { spawnSync } = require('child_process');
                const decoder = new TextDecoder();
                const rebase = spawnSync('git', ['rebase', 'origin/master'], {
                  cwd: vscode.workspace.rootPath
                });

                let { stderr, stdout } = rebase;
                stderr = decoder.decode(stderr);
                stdout = decoder.decode(stdout);
                if (stderr) {
                  vscode.window.showErrorMessage(stderr);
                  return;
                }
              } catch (err) {
                console.log(err);
                vscode.window.showErrorMessage(err.stderr);
                return;
              }
              // vscode.window.showInformationMessage(`git rebase origin/master`);

              // Update status to Active, and assign to currentUser
              //
              try {
                await witApi.updateWorkItem(null, [{
                  "op": "replace",
                  "path": `/fields/System.AssignedTo`,
                  "value": currentUser
                }, {
                  "op": "replace",
                  "path": `/fields/System.State`,
                  "value": "Active"
                }], id);
              } catch (err) {
                console.log(err);
                vscode.window.showErrorMessage(err.stderr);
                return;
              }

              return;
            }
            vscode.window.showInformationMessage(`Done`);
            await vscode.commands.executeCommand(Commands.Refresh);
          }

          // Finish working on a branch
          //
          if (action === "finishWork") {
            const gitExtension = vscode.extensions.getExtension<GitExtension>(
              "vscode.git"
            );
            if (!gitExtension) return;
            const git = gitExtension.exports.getAPI(1);
            if (git.repositories.length) {
              const repo = git.repositories[0];

              try {
                await repo.fetch();
              } catch (err) {
                vscode.window.showErrorMessage(err.stderr);
                return;
              }
              // vscode.window.showInformationMessage("git fetch");

              try {
                await repo.checkout(value);
              } catch (err) {
                console.log(err);
                vscode.window.showErrorMessage(err.stderr);
                return;
              }
              // vscode.window.showInformationMessage(`git checkout ${value}`);

              try {
                await repo.push();
              } catch (err) {
                vscode.window.showErrorMessage(err.stderr);
                return;
              }
              // vscode.window.showInformationMessage("git push");

              try {
                await repo.checkout("master");
              } catch (err) {
                console.log(err);
                vscode.window.showErrorMessage(err.stderr);
                return;
              }
              // vscode.window.showInformationMessage(`git checkout master`);

              try {
                await repo.deleteBranch(value);
              } catch (err) {
                console.log(err);
                vscode.window.showErrorMessage(err.stderr);
                return;
              }
              // vscode.window.showInformationMessage(`git branch -D ${value}`);

              // Open the Pull Request URL
              //
              // @ts-ignore
              vscode.env.openExternal(vscode.Uri.parse(`${currentOrganization.uri}/${currentProject.name}/_git/${currentRepo}/pullrequestcreate?sourceRef=${encodeURIComponent(value)}`));

              // Update the work item to "Resolved"
              //
              try {
                await witApi.updateWorkItem(null, [{
                  "op": "replace",
                  "path": `/fields/System.State`,
                  "value": "Resolved"
                }], id);
              } catch (err) {
                console.log(err);
                vscode.window.showErrorMessage(err.stderr);
                return;
              }

              return;
            }
            vscode.window.showInformationMessage(`Done`);
            await vscode.commands.executeCommand(Commands.Refresh);
          }

          // Checkout a branch - not used by itself any more I think...
          //
          if (action === "checkout") {
            const gitExtension = vscode.extensions.getExtension<GitExtension>(
              "vscode.git"
            );
            if (!gitExtension) return;
            const git = gitExtension.exports.getAPI(1);
            if (git.repositories.length) {
              const repo = git.repositories[0];
              try {
                await repo.checkout(id);
              } catch (err) {
                console.log(err);
                vscode.window.showErrorMessage(err.stderr);
              }
              return;
            }
            await vscode.commands.executeCommand(Commands.Refresh);
          }

          // Create a development branch for the work item
          //
          if (action === "createBranch") {

            // value is the name of the work item
            // We replace all non-alphanumeric or space chars, and replace spaces with -
            // 
            value = value.toLowerCase().replace(/[^a-zA-Z0-9 ]/g, "").trim().replace(/\ /g, "-");
            let name = `${branchPrefix}${id}-${value}`;
            // @ts-ignore
            name = await vscode.window.showInputBox({
              value: name,
              prompt: "Enter branch name"
            });
            if (!name) return;

            const gitApi = await webApi.getGitApi();

            // We need to branch off the HEAD of master
            // So, we need to get that commit id
            //
            // @ts-ignore
            const master = await gitApi.getBranch(currentRepo, "master");
            // @ts-ignore
            const head = master.commit.commitId;

            // This creates the branch
            //
            // @ts-ignore
            const result = await gitApi.updateRefs([{
              name: `refs/heads/${name}`,
              newObjectId: head,

              // Just running the command in the browser, it seems to send this oldObjectId value, so 
              // just doing that here also...
              // (a lot of these APIs are not well documented...)
              //
              oldObjectId: "0000000000000000000000000000000000000000"
            }],
              // @ts-ignore
              currentRepo, currentProject.id);

            if (!result[0].success) {
              vscode.window.showErrorMessage("Failed to create remote branch");
              return;
            }

            let url = encodeURIComponent(`${currentProject.id}/${currentRepo}/GB${name}`);
            url = `vstfs:///Git/Ref/${url}`;

            // This links the branch to the work item
            //
            await witApi.updateWorkItem(null, [{
              "op": "add",
              "path": `/relations/-`,
              "value": {
                "rel": "ArtifactLink",
                "url": url,
                "attributes": {
                  "name": "Branch"
                }
              }
            }], id);

            await vscode.commands.executeCommand(Commands.Refresh);
            return;
          }

          if (action === "updateField") {
            // vscode.window.showErrorMessage(`[${id}] Updating ${field} to: ${value}`);

            if (field === "System.Description") {
              try {
                let showdown = require("showdown");
                let converter = new showdown.Converter();
                value = converter.makeHtml(value);
              } catch (err) {
                console.error(err);
              }
            }

            await witApi.updateWorkItem(null, [{
              "op": "replace",
              "path": `/fields/${field}`,
              "value": value
            }], id);

            await vscode.commands.executeCommand(Commands.Refresh);
          }

          // There were issues with doing this, since the initial args is captured in the closure
          // of the webview onDidReceiveMessage()
          //
          // if (field === "System.Title") {
          //   panel.args.workItemTitle = value;
          // }
          // if (field === "System.Description") {
          //   panel.args.workItemDescription = value;
          // }
          // if (field === "Microsoft.VSTS.Scheduling.StoryPoints") {
          //   panel.args.workItemStoryPoints = value;
          // }
          // panel.webview.html = await getWebviewContent(panel.args);

        },
        undefined,
        context.subscriptions
      );
    }

    // @ts-ignore
    panel.reveal();
    // @ts-ignore
    panel.webview.html = await getWebviewContent(args);
    // panel.args = args;

    // @ts-ignore
    async function getWebviewContent(workItem) {
      // @ts-ignore
      const { workItemAssignedTo = {} } = workItem;
      const AssignedToName = workItemAssignedTo.displayName || "Unassigned";
      const AssignedToEmail = workItemAssignedTo.uniqueName || "";
      const AssignedToIcon = workItemAssignedTo.base64 || "";

      var markdown = "";
      try {
        var TurndownService = require('turndown')
        var turndownService = new TurndownService()
        // @ts-ignore
        markdown = turndownService.turndown(workItem.workItemDescription || "");
      } catch (err) { console.error(err) }

      // @ts-ignore
      const state = workItem.workItemState;
      var state_color = "#007ACC";
      if (state === "New") {
        state_color = "#B2B2B2";
      } else if (state === "Closed") {
        state_color = "#339933";
      }

      // @ts-ignore
      const hasBranch = !!(workItem.workItemBranch && workItem.workItemBranch.name);

      return /*html*/`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <style>

          body {
            margin: 10px;
          }

          .title {
            font-size: 30px;
          }

          .workItemIcon {
            background-image: url(${workItem.workItemIcon});
            background-position: center;
            background-size: cover;
            width: 50px;
            height: 50px;
          }

          .workItemTitle {
            font-size: 30px;
          }

          .row1 {
            display: grid;
            grid-template-columns: auto 1fr auto;
            align-items: center;
            grid-gap: 10px;
          }

          .row1-icon {
            background-image: url(${workItem.workItemIcon});
            background-position: center;
            background-size: cover;
            width: 20px;
            height: 20px;
          }

          .row1-title {
            font-size: 20px;
            text-transform: uppercase;
          }

          .row1-link {
            cursor: pointer;
            display: inline-block;
          }

          .row2 {
            display: grid;
            grid-template-columns: auto 1fr;
            align-items: center;
            grid-gap: 10px;
            font-size: 20px;
            margin-top: 0px;
          }

          .row2-title > input {
            font: inherit;
            border: inherit;
            background: inherit;
            color: inherit;
            padding: 0 2px;
            cursor: pointer;
            width: 100%;
            max-width: 600px;
          }

          .row3 {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            grid-gap: 0 10px;
            margin-top: 30px;
          }

          .assigned {
            display: grid;
            grid-template-columns: auto 1fr;
            grid-template-rows: 1fr 1fr;
            grid-gap: 0 10px;
            align-items: center;
          }

          .assigned-icon {
            background-image: url(${AssignedToIcon});
            background-position: center;
            background-size: cover;
            width: 35px;
            height: 35px;

            grid-row: 1 / 3;
            border-radius: 50%;
          }

          .assigned-name {
            font-size: 15px;
          }
          .assigned-email {
            font-size: 12px;
          }

          .state {
            display: grid;
            grid-template-columns: auto 1fr;
            grid-template-rows: 1fr 1fr;
            grid-gap: 0 10px;
            align-items: center;
          }

          .state-icon {
            background-color: ${state_color};
            width: 25px;
            height: 25px;

            grid-row: 1 / 3;
            border-radius: 50%;
          }

          .state-name {
            font-size: 15px;
          }
          .state-reason {
            font-size: 12px;
          }

          .points {
            display: grid;
            grid-template-columns: auto 1fr;
            grid-gap: 0 10px;
            align-items: center;
          }

          .points-input {
            width: 36px;
            height: 36px;
            border: 2px solid #777;
            border-radius: 50%;
            position: relative;
            cursor: pointer;
          }

          .points-input:focus-within {
            border: 2px solid rgb(229, 151, 0);
          }

          .points-title {
            font-size: 15px;
            line-height: 15px;
          }

          #input-points {
            width: 100%;
            text-align: center;
            font: inherit;
            color: inherit;
            background: inherit;
            border: none;
            position: absolute;
            top: -2px;
            left: 0;
            right: 0;
            bottom: 0;
            height: 100%;
            font-size: 16px;
            line-height: 36px;
            font-family: Cascadia Mono;
            cursor: pointer;
          }

          #input-points:focus {
            outline: none !important;
          }

          #input-points::-webkit-outer-spin-button,
          #input-points::-webkit-inner-spin-button {
            -webkit-appearance: none;
            margin: 0;
          }

          .row4 {
            height: 250px;
            margin-top: 30px;
          }

          .row4-title {
            font-size: 20px;
          }

          .workItemDescription {
            min-height: 180px;
            height: 180px;
            width: 100%;
            max-width: 600px;
          }
          #input-description {
            height: 160px;
            min-height: 160px;
            width: calc(100% - 20px);
            max-width: 580px;
            font: inherit;
            background: inherit;
            color: inherit;
            padding: 10px;
            resize: none;
          }
          #preview-description {
            cursor: pointer;
            padding: 0 10px;
            height: 100%;
            border: 1px solid #555;
            overflow-y: auto;
          }

          .row5 {
            margin-top: 30px;
          }

          .row5-title {
            font-size: 20px;
            border-bottom: 1px solid #555;  
          }

          .branch {
            display: grid;
            grid-template-columns: auto 1fr;
            grid-template-rows: 1fr 1fr;
            grid-gap: 0 10px;
            align-items: center;
            padding: 20px 5px;
          }

          .branch-icon {
            background-image: url(data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB3aWR0aD0iNTBwdCIgaGVpZ2h0PSI1MHB0IiB2aWV3Qm94PSIwIDAgNTAgNTAiIHZlcnNpb249IjEuMSI+CjxnIGlkPSJzdXJmYWNlMTYzNzQ4MSI+CjxwYXRoIHN0eWxlPSIgc3Ryb2tlOm5vbmU7ZmlsbC1ydWxlOm5vbnplcm87ZmlsbDpyZ2IoMTAwJSwxMDAlLDEwMCUpO2ZpbGwtb3BhY2l0eToxOyIgZD0iTSAxMyAzIEMgMTAuMjUgMyA4IDUuMjUgOCA4IEMgOCAxMC40MDYyNSA5LjcyNjU2MiAxMi40Mzc1IDEyIDEyLjkwNjI1IEwgMTIgMzcuMDkzNzUgQyA5LjcyNjU2MiAzNy41NjI1IDggMzkuNTkzNzUgOCA0MiBDIDggNDQuNzUgMTAuMjUgNDcgMTMgNDcgQyAxNS43NSA0NyAxOCA0NC43NSAxOCA0MiBDIDE4IDM5LjYwNTQ2OSAxNi4yODkwNjIgMzcuNTc0MjE5IDE0LjAzMTI1IDM3LjA5Mzc1IEMgMTQuMjE4NzUgMzMuNjk1MzEyIDE1LjQ0NTMxMiAzMS45NTcwMzEgMTcuMjgxMjUgMzAuNzgxMjUgQyAxOS4yODEyNSAyOS41MDM5MDYgMjIuMTU2MjUgMjguOTY0ODQ0IDI1LjE1NjI1IDI4LjQ2ODc1IEMgMjguMTU2MjUgMjcuOTcyNjU2IDMxLjI4MTI1IDI3LjUwMzkwNiAzMy43ODEyNSAyNS45MDYyNSBDIDM2LjEwNTQ2OSAyNC40MjE4NzUgMzcuNzE0ODQ0IDIxLjg1OTM3NSAzNy45Mzc1IDE3LjkwNjI1IEMgNDAuMjM4MjgxIDE3LjQ2MDkzOCA0MiAxNS40MjU3ODEgNDIgMTMgQyA0MiAxMC4yNSAzOS43NSA4IDM3IDggQyAzNC4yNSA4IDMyIDEwLjI1IDMyIDEzIEMgMzIgMTUuMzk0NTMxIDMzLjcxMDkzOCAxNy40MjU3ODEgMzUuOTY4NzUgMTcuOTA2MjUgQyAzNS43ODEyNSAyMS4zMDA3ODEgMzQuNTU0Njg4IDIzLjA0Njg3NSAzMi43MTg3NSAyNC4yMTg3NSBDIDMwLjcxODc1IDI1LjQ5MjE4OCAyNy44NDM3NSAyNi4wMDM5MDYgMjQuODQzNzUgMjYuNSBDIDIxLjg0Mzc1IDI2Ljk5NjA5NCAxOC43MTg3NSAyNy40OTYwOTQgMTYuMjE4NzUgMjkuMDkzNzUgQyAxNS4zNzUgMjkuNjMyODEyIDE0LjYyODkwNiAzMC4zMjQyMTkgMTQgMzEuMTU2MjUgTCAxNCAxMi45MDYyNSBDIDE2LjI3MzQzOCAxMi40Mzc1IDE4IDEwLjQwNjI1IDE4IDggQyAxOCA1LjI1IDE1Ljc1IDMgMTMgMyBaIE0gMTMgNSBDIDE0LjY2Nzk2OSA1IDE2IDYuMzMyMDMxIDE2IDggQyAxNiA5LjY2Nzk2OSAxNC42Njc5NjkgMTEgMTMgMTEgQyAxMS4zMzIwMzEgMTEgMTAgOS42Njc5NjkgMTAgOCBDIDEwIDYuMzMyMDMxIDExLjMzMjAzMSA1IDEzIDUgWiBNIDM3IDEwIEMgMzguNjY3OTY5IDEwIDQwIDExLjMzMjAzMSA0MCAxMyBDIDQwIDE0LjY2Nzk2OSAzOC42Njc5NjkgMTYgMzcgMTYgQyAzNS4zMzIwMzEgMTYgMzQgMTQuNjY3OTY5IDM0IDEzIEMgMzQgMTEuMzMyMDMxIDM1LjMzMjAzMSAxMCAzNyAxMCBaIE0gMTMgMzkgQyAxNC42Njc5NjkgMzkgMTYgNDAuMzMyMDMxIDE2IDQyIEMgMTYgNDMuNjY3OTY5IDE0LjY2Nzk2OSA0NSAxMyA0NSBDIDExLjMzMjAzMSA0NSAxMCA0My42Njc5NjkgMTAgNDIgQyAxMCA0MC4zMzIwMzEgMTEuMzMyMDMxIDM5IDEzIDM5IFogTSAxMyAzOSAiLz4KPC9nPgo8L3N2Zz4K);
            background-size: contain;
            background-position: center;
            width: 35px;
            height: 35px;
            grid-row: 1 / 3;
          }

          .branch-name {
            font-size: 15px;
          }
          .branch-state {
            font-size: 12px;
          }

          .branch-create {
            grid-row: 1 / 3;
            font-size: 14px;
          }

          .actions {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
            grid-gap: 20px;
          }

          .action-button {
            display: grid;
            grid-template-columns: 30px 1fr;
            align-items: center;
            height: 40px;
            cursor: pointer;
            border: 1px solid #555;
            grid-gap: 5px;
            border-radius: 5px;
            padding: 0 5px;
          }

          .action-button:hover {
            border: 1px solid #FCE557;
          }

          .action-button:active {
            border: 1px solid #999;
          }

          .action-button-icon {
            background-size: contain;
            background-position: center;
            width: 20px;
            height: 20px;
            justify-self: center;
          }

          .action[data-id="start"] .action-button-icon {
            background-image: url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiIHdpZHRoPSIxOHB4IiBoZWlnaHQ9IjE4cHgiPjxwYXRoIGQ9Ik0wIDBoMjR2MjRIMHoiIGZpbGw9Im5vbmUiLz48cGF0aCBkPSJNMTAgMTYuNWw2LTQuNS02LTQuNXY5ek0xMiAyQzYuNDggMiAyIDYuNDggMiAxMnM0LjQ4IDEwIDEwIDEwIDEwLTQuNDggMTAtMTBTMTcuNTIgMiAxMiAyem0wIDE4Yy00LjQxIDAtOC0zLjU5LTgtOHMzLjU5LTggOC04IDggMy41OSA4IDgtMy41OSA4LTggOHoiLz48L3N2Zz4=);
          }

          .action[data-id="finish"] .action-button-icon {
            background-image: url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiIHdpZHRoPSIxOHB4IiBoZWlnaHQ9IjE4cHgiPjxwYXRoIGQ9Ik0wIDBoMjR2MjRIMFYwem0wIDBoMjR2MjRIMFYweiIgZmlsbD0ibm9uZSIvPjxwYXRoIGQ9Ik0xNi41OSA3LjU4TDEwIDE0LjE3bC0zLjU5LTMuNThMNSAxMmw1IDUgOC04ek0xMiAyQzYuNDggMiAyIDYuNDggMiAxMnM0LjQ4IDEwIDEwIDEwIDEwLTQuNDggMTAtMTBTMTcuNTIgMiAxMiAyem0wIDE4Yy00LjQyIDAtOC0zLjU4LTgtOHMzLjU4LTggOC04IDggMy41OCA4IDgtMy41OCA4LTggOHoiLz48L3N2Zz4=);
          }

          .action-button-label {
            padding-bottom: 2px;
          }

          .action-info {
            padding-top: 10px;
          }

          .action-info > div {
            white-space: nowrap;
            overflow-x: hidden;
            text-overflow: ellipsis;
            padding: 1px 5px;
          }

        </style>
        <body>

          <div class="row1">
            <div class="row1-icon">
            </div>
            <div class="row1-title">
              ${workItem.workItemType} ${workItem.workItemId}
            </div>
            <div class="row1-link">
              <a href="${workItem.url}">Open in Azure Boards</a>
            </div>
          </div>


          <div class="row2">
            <div class="row2-id">
              ${workItem.workItemId} 
            </div>
            <div class="row2-title">
              <input id="input-title" type="text" value="${workItem.workItemTitle}">
            </div>
          </div>

          <div class="row3">
            <div class="assigned">
              <div class="assigned-icon">
              </div>
              <div class="assigned-name">
                ${AssignedToName}
              </div>
              <div class="assigned-email">
                ${AssignedToEmail}
              </div>
            </div>

            <div class="state">
              <div class="state-icon">
              </div>
              <div class="state-name">
                ${workItem.workItemState}
              </div>
              <div class="state-reason">
                ${workItem.workItemReason}
              </div>
            </div>

            <div class="points">
              <div class="points-input">
                <input id="input-points" type="number" value="${workItem.workItemStoryPoints}">
              </div>
              <div class="points-title">Story Points</div>
            </div>
          </div>
          
          <div class="row4">
            <div class="row4-title">Description</div>
            <div class="workItemDescription">
              <textarea id="input-description" style="display: none";>${markdown}</textarea>
              <div id="preview-description">${workItem.workItemDescription}</div>
            </div>
          </div>

          <div class="row5">
            <div class="row5-title">Development</div>

            <div class="branch">
              <div class="branch-icon">
              </div>
              <div class="branch-name" style="display: ${hasBranch ? 'block' : 'none'}">
                ${workItem.workItemBranch.name || ""}
              </div>
              <div class="branch-state" style="display: ${hasBranch ? 'block' : 'none'}">
                Ahead: ${workItem.workItemBranch.aheadCount}, Behind: ${workItem.workItemBranch.behindCount}&nbsp;&nbsp;⇄&nbsp;&nbsp;origin/master
              </div>
              <div class="branch-create" style="display: ${hasBranch ? 'none' : 'block'}">
                <a id="create-branch" href="#">Create Branch</a>
              </div>
            </div>

            <div class="actions" style="display: ${hasBranch ? 'grid' : 'none'}">
              <div class="action" data-id="start">
                <div id="start-work" class="action-button">
                  <div class="action-button-icon">
                  </div>
                  <div class="action-button-label">
                    Start Work on: ${workItem.workItemType} ${workItem.workItemId}
                  </div>
                </div>
                <div class="action-info">
                  <div>$ git fetch</div>
                  <div>$ git checkout ${workItem.workItemBranch.name}</div>
                  <div>$ git pull ${workItem.workItemBranch.name}</div>
                  <div>$ git rebase origin/master</div>
                </div>
              </div>
              <div class="action" data-id="finish">
                <div id="finish-work" class="action-button">
                  <div class="action-button-icon">
                  </div>
                  <div class="action-button-label">
                    Finish Work on: ${workItem.workItemType} ${workItem.workItemId}
                  </div>
                </div>
                <div class="action-info">
                  <div>$ git push</div>
                  <div>$ git branch -D ${workItem.workItemBranch.name}</div>
                  <div>Open PR for: ${workItem.workItemBranch.name}</div>
                </div>
              </div>
            </div>

          </div>

          <div class="row5" style="display: none">
            Branch: ${workItem.workItemBranch.name || ""}
            <br>Ahead: ${workItem.workItemBranch.aheadCount || ""}
            <br>Behind: ${workItem.workItemBranch.behindCount || ""}
            <br>
            <a id="checkout-branch" href="#" data-id="${workItem.workItemBranch.name}">
              Checkout: ${workItem.workItemBranch.name || ""}
            </a>
            <br>
            <a id="rebase-branch" href="#" data-id="${workItem.workItemBranch.name}">
              Rebase with: origin/master
            </a>
            <br>
            <a id="create-branch" href="#">
              Create New Linked Branch
            </a>
          </div>
          
          <script>
            (function() {

              window.addEventListener('DOMContentLoaded', () => {
                  const vscode = acquireVsCodeApi();
                  document.getElementById("input-title").addEventListener("change", (ev) => {
                    vscode.postMessage({
                      action: "updateField",
                      field: "System.Title",
                      id: ${workItem.workItemId},
                      value: ev.currentTarget.value
                    });
                  });

                  document.getElementById("input-description").addEventListener("change", (ev) => {
                    vscode.postMessage({
                      action: "updateField",
                      field: "System.Description",
                      id: ${workItem.workItemId},
                      value: ev.currentTarget.value
                    });
                  });
                  document.getElementById("input-description").addEventListener("blur", (ev) => {
                    ev.currentTarget.style.display = "none";
                    document.getElementById("preview-description").style.display = "block";
                  });
                  document.getElementById("preview-description").addEventListener("click", (ev) => {
                    ev.currentTarget.style.display = "none";
                    document.getElementById("input-description").style.display = "block";
                    document.getElementById("input-description").focus();
                  });

                  document.getElementById("input-points").addEventListener("change", (ev) => {
                    vscode.postMessage({
                      action: "updateField",
                      field: "Microsoft.VSTS.Scheduling.StoryPoints",
                      id: ${workItem.workItemId},
                      value: ev.currentTarget.value
                    });
                  });

                  document.getElementById("create-branch").addEventListener("click", (ev) => {
                    vscode.postMessage({
                      action: "createBranch",
                      id: ${workItem.workItemId},
                      value: "${workItem.workItemTitle}"
                    });
                  });

                  document.getElementById("start-work").addEventListener("click", (ev) => {
                    vscode.postMessage({
                      action: "startWork",
                      value: "${workItem.workItemBranch.name}",
                      id: ${workItem.workItemId}
                    });
                  });

                  document.getElementById("finish-work").addEventListener("click", (ev) => {
                    vscode.postMessage({
                      action: "finishWork",
                      value: "${workItem.workItemBranch.name}",
                      id: ${workItem.workItemId}
                    });
                  });
              });
            }())
          </script>

        </body>
        </html>
      `;
    }

    return;
  });

  // This is the "#" icon on the tree items...
  // Just copy the work item id and title to clipboard...
  //
  vscode.commands.registerCommand(Commands.WorkItemMention, async args => {
    let { workItemId, workItemTitle } = args;
    await vscode.env.clipboard.writeText(`#${workItemId} - ${workItemTitle}`);
    return;
  });

  // This is the previous function...
  //
  // Configuration
  //

  /*
  function mentionWorkItem(
    gitExtension: vscode.Extension<GitExtension> | undefined,
    workItemId: number
  ) {
    if (gitExtension) {
      const git = gitExtension.exports.getAPI(1);
      if (git.repositories.length) {
        // Determine whether source control is GitHub, if so, prefix mention ID syntax with "AB"
        let mentionSyntaxPrefix: string = ``;
        const activeRemotes: Remote[] = [];
        const originRemotes = git.repositories[0].state.remotes.find(
          remote => remote.name === "origin"
        );
        if (originRemotes) {
          activeRemotes.push(originRemotes);
          const remoteUrl =
            activeRemotes[0].fetchUrl || activeRemotes[0].pushUrl || "";
          mentionSyntaxPrefix = determineMentionSyntaxPrefix(
            remoteUrl,
            mentionSyntaxPrefix
          );
        } else {
          vscode.window.showInformationMessage(
            "No Git source control origin remotes found."
          );
        }

        // Add work item mention to new line if existing commit message, otherwise start with Fix mention
        const existingCommitMessage: string =
          git.repositories[0].inputBox.value;
        let mentionText: string = ``;
        if (existingCommitMessage) {
          mentionText =
            `\n` + `Fixes ` + mentionSyntaxPrefix + `#${workItemId}`;
        } else {
          mentionText = `Fix ` + mentionSyntaxPrefix + `#${workItemId} `;
        }
        git.repositories[0].inputBox.value += mentionText;

        // Navigate to the Source Control view
        vscode.commands.executeCommand("workbench.view.scm");
      } else {
        vscode.window.showInformationMessage(
          "No Git source control repositories found."
        );
      }
    } else {
      vscode.window.showInformationMessage(
        "No Git source control extension found."
      );
    }

    function determineMentionSyntaxPrefix(
      remoteUrl: string,
      mentionSyntaxPrefix: string
    ) {
      // TODO: Determine if GitHub Enterprise (non "github.com" host)
      const remoteUri = vscode.Uri.parse(remoteUrl);
      const authority = remoteUri.authority;
      const matches = /^(?:.*:?@)?([^:]*)(?::.*)?$/.exec(authority);
      if (
        matches &&
        matches.length >= 2 &&
        matches[1].toLowerCase() === "github.com"
      ) {
        mentionSyntaxPrefix = `AB`;
      }
      return mentionSyntaxPrefix;
    }
  }
  */
}
