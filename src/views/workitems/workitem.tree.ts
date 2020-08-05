// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See LICENSE in the project root for license information.

import * as vscode from "vscode";
import { WorkItemComposite } from "./workitem";
import { MyWorkProvider } from "./workitem.mywork";
import { getCurrentOrganization, getQueries } from "../../configuration/configuration";
import { ConfigurationCommands } from "../../configuration/commands";
import { Commands } from "../../commands/commands";
import { trackTelemetryException } from "../../util/telemetry";

// See: 
// https://code.visualstudio.com/api/extension-guides/tree-view
// https://code.visualstudio.com/api/references/vscode-api#TreeView
// https://stackoverflow.com/questions/52592853/how-to-create-a-tree-as-extension-for-vs-code
//
// TODO: should refactor this a little - the same logic is duplicated for parent and child nodes
//
export class WorkItemTreeNodeProvider
  implements vscode.TreeDataProvider<TreeNodeParent> {
  private _onDidChangeTreeData: vscode.EventEmitter<
    TreeNodeParent | undefined
  > = new vscode.EventEmitter<TreeNodeParent | undefined>();

  readonly onDidChangeTreeData: vscode.Event<TreeNodeParent | undefined> = this
    ._onDidChangeTreeData.event;

  getChildren(
    element?: TreeNodeParent | undefined
  ): vscode.ProviderResult<TreeNodeParent[]> {

    // getChildren is called when the Tree Item / Node is activated / expanded
    // 

    // This is for the top level items - i.e. one item for each Query
    //
    if (!element) {
      if (!vscode.workspace.workspaceFolders) {
        return [new NoOpenFolderNode()];
      }

      if (!getCurrentOrganization()) {
        return [new NoConnectionNode()];
      }

      // Get the collection of queries
      // TODO: currently you have to specify a display name for the Query in the Settings, but
      // we could of course get the name from the Azure API also
      // The .id here is the UUID you see in the web interface (URI) for the Query...
      //
      const queries = getQueries() || [];
      const top_level_items = [];
      for (let query of queries) {
        top_level_items.push(new TreeNodeChildWorkItem(query.name, query.id));
      }
      return top_level_items;
    }

    // If we have an element but no data, then this is a Work Item with no parent
    // (so it's going to be at the top of the tree, within a query)
    // Once we call element.getWorkItemData() here, we will set this.data on the element
    // and so for child nodes, we skip on to the next block...
    // element.getWorkItemData() is where all the fetching from Azure API happens. We populate
    // all the WorkItems for each Query, and use that below for each tree level...
    //
    if (!element.data) {
      return element.getWorkItemData();
    }

    // This is pretty simple. We already have the data - we are just searching for items whose WorkItem.parent is
    // the current element
    //
    return element.getWorkItemChildren();
  }

  getTreeItem(
    element: TreeNodeParent
  ): vscode.TreeItem | Thenable<vscode.TreeItem> {
    return element;
  }

  refresh(): void {
    // Cause view to refresh
    this._onDidChangeTreeData.fire();
  }
}

export class TreeNodeParent extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    collapsibleState: vscode.TreeItemCollapsibleState =
      vscode.TreeItemCollapsibleState.Collapsed
  ) {
    super(label, collapsibleState);
  }

  async getWorkItemData(): Promise<TreeNodeParent[]> {
    return [];
  }

  async getWorkItemChildren(): Promise<TreeNodeParent[]> {
    return [];
  }
}

class NoOpenFolderNode extends TreeNodeParent {
  constructor() {
    super(Resources.Configuration_NoOpenFolder);

    this.contextValue = "no-folder";
    this.iconPath = undefined;
  }
}

class NoConnectionNode extends TreeNodeParent {
  constructor() {
    super(Resources.Configuration_ClickToConnect);

    this.contextValue = "no-connection";
    this.iconPath = undefined;
    this.command = {
      title: "Connect",
      command: ConfigurationCommands.SelectOrganization
    };
  }
}

export class TreeNodeChildWorkItem extends TreeNodeParent {
  public id: any;
  public data: any;

  constructor(label: string, private readonly type: string) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.data = null;
  }

  // Fetch all the data, set it on .data, and then call getWorkItemChildren()
  // Returns a promise resolving to the array of Work Item Nodes (same as getWorkItemChildren())
  //
  async getWorkItemData(): Promise<TreeNodeParent[]> {
    try {
      //go get the work items from the mywork provider
      const myWorkProvider: MyWorkProvider = new MyWorkProvider();

      //get mashed list of workitems from the myworkprovider
      const workItems = await myWorkProvider.getMyWorkItems(this.type);
      this.data = workItems;
      return await this.getWorkItemChildren();
    } catch (e) {
      // track telemetry exception
      trackTelemetryException(e);
      console.error(e);
    }

    return [];
  }

  async getWorkItemChildren(): Promise<TreeNodeParent[]> {
    try {

      // This is a bit hacky but it's fine. We add the .workItemId property when creating the WorkItemNode() below.
      // So, once you call this function on a Node - that Node should have the .workItemId set, and
      // all we need to do is find the elements of this.data that have .workItemParent equal to our .workItemId
      //
      const children = this.data.filter((wi = {}) => {
        return (wi.workItemParent == this.workItemId);
      });

      // Default is vscode.TreeItemCollapsibleState.Collapsed
      // But if there are no children - we don't want that...
      //
      if (!children.length) this.collapsibleState = vscode.TreeItemCollapsibleState.None;

      // Note: we pass in this.data recursively to each new node we create
      // So, all Nodes have a reference to this - and each one will independently pick out
      // it's children..
      // Could be more efficient / cleaner but it's fine for now...
      //
      return children.map(wi => new WorkItemNode(wi, this.data));
    } catch (e) {
      // track telemetry exception
      trackTelemetryException(e);
      console.error(e);
    }

    return [];
  }
}

export class WorkItemNode extends TreeNodeParent {
  public readonly workItemId: number;
  public readonly workItemType: string;
  public readonly iconPath: vscode.Uri;
  public readonly editUrl: string;

  constructor(workItemComposite: WorkItemComposite, data) {

    // So, we want to add the .workItemStateIcon as a prefix to the label of the tree item
    // It will sit just next to the work item type icon...
    //
    super(`${workItemComposite.workItemStateIcon} ${workItemComposite.workItemId} ${workItemComposite.workItemTitle}`);

    this.iconPath = vscode.Uri.parse(workItemComposite.workItemIcon);
    this.workItemId = +workItemComposite.workItemId;
    this.workItemTitle = workItemComposite.workItemTitle;
    this.workItemType = workItemComposite.workItemType;
    this.editUrl = workItemComposite.url;
    this.contextValue = "work-item";

    const assignedTo = (workItemComposite.workItemAssignedTo || {}).displayName || "Unassigned";

    // this.description is slighly smaller text, just after the main label
    // Could probably remove the workItemState from this, now that we have the "icon"...
    //
    this.description = `${assignedTo}  •  ${workItemComposite.workItemState}`;

    this.tooltip = `${workItemComposite.workItemType}: ${workItemComposite.workItemId} ${workItemComposite.workItemTitle}\nAssigned to: ${assignedTo}\nState: ${workItemComposite.workItemState} `;

    // Recursively pass a reference to the collection of work items
    //
    this.data = data;

    // Default is vscode.TreeItemCollapsibleState.Collapsed
    // But if there are no children - we don't want that...
    // I think we have to do this in the constructor (I don't think it's possible to change that state later..)
    // 
    this.children = data.filter((wi = {}) => {
      const { workItemParent } = wi;
      return (workItemParent == this.workItemId);
    });
    if (!this.children.length) this.collapsibleState = vscode.TreeItemCollapsibleState.None;

    this.command = {
      command: Commands.WorkItemPreview,
      arguments: [workItemComposite],
      title: "Preview"
    };
  }

  async getWorkItemChildren(): Promise<TreeNodeParent[]> {
    try {
      return this.children.map(wi => new WorkItemNode(wi, this.data));
    } catch (e) {
      // track telemetry exception
      trackTelemetryException(e);
      console.error(e);
    }

    return [];
  }
}
