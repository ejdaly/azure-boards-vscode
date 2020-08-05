// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See LICENSE in the project root for license information.

import * as vscode from "vscode";
import { WorkItemComposite } from "./workitem";
import { MyWorkProvider } from "./workitem.mywork";
import { getCurrentOrganization, getQueries } from "../../configuration/configuration";
import { ConfigurationCommands } from "../../configuration/commands";
import { Commands } from "../../commands/commands";
import { trackTelemetryException } from "../../util/telemetry";
// import * as _ from "underscore";

var _ = require("underscore");

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
    if (!element) {
      if (!vscode.workspace.workspaceFolders) {
        return [new NoOpenFolderNode()];
      }

      if (!getCurrentOrganization()) {
        return [new NoConnectionNode()];
      }

      // return [
      //   new TreeNodeChildWorkItem("Assigned to me", "AssignedToMe"),
      //   new TreeNodeChildWorkItem("My activity", "MyActivity"),
      //   new TreeNodeChildWorkItem("Mentioned", "Mentioned"),
      //   new TreeNodeChildWorkItem("Following", "Following")
      // ];

      const queries = getQueries() || [];
      console.log("queries");
      console.log(queries);
      const top_level_items = [];
      for (let q of queries) {
        console.log(q);
        top_level_items.push(new TreeNodeChildWorkItem(q.name, q.id));
      }
      return top_level_items;
      // return queries?.map(({ name, id }) => {
      //   return new TreeNodeChildWorkItem(name, id)
      // });

      // return [
      //   new TreeNodeChildWorkItem("Query1", "asdf")
      // ];
    }

    console.log("element");
    console.log({ element });
    if (!element.data) {
      console.log("returning getWorkItemData");
      return element.getWorkItemData();
    }

    console.log("returning getWorkItemChildren");
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
      // vscode.TreeItemCollapsibleState.None
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

  async getWorkItemsForNode(): Promise<TreeNodeParent[]> {
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

  async getWorkItemData(): Promise<TreeNodeParent[]> {
    try {
      //go get the work items from the mywork provider
      const myWorkProvider: MyWorkProvider = new MyWorkProvider();

      //get mashed list of workitems from the myworkprovider
      const workItems = await myWorkProvider.getMyWorkItems(this.type);
      console.log("getWorkItemData");
      console.log({ workItems });
      this.data = workItems;

      const work_item_children = await this.getWorkItemChildren();
      console.log({ work_item_children });

      return work_item_children;
    } catch (e) {
      // track telemetry exception
      trackTelemetryException(e);

      console.error(e);
    }

    return [];
  }

  async getWorkItemChildren(): Promise<TreeNodeParent[]> {
    try {
      console.log(`getWorkItemChildren: ${this.workItemId}`);
      console.log({ this_: this });
      const children = this.data.filter((wi = {}) => {
        const { workItemParent } = wi;
        return (workItemParent == this.workItemId);
      });
      if (!children.length) this.collapsibleState = vscode.TreeItemCollapsibleState.None;
      // return this.data.map(wi => new WorkItemNode(wi));
      return children.map(wi => new WorkItemNode(wi, this.data));
    } catch (e) {
      // track telemetry exception
      trackTelemetryException(e);

      console.error(e);
    }

    return [];
  }

  async getWorkItemsForNode(): Promise<TreeNodeParent[]> {
    try {
      //go get the work items from the mywork provider
      const myWorkProvider: MyWorkProvider = new MyWorkProvider();

      //get mashed list of workitems from the myworkprovider
      const workItems = await myWorkProvider.getMyWorkItems(this.type);
      this.data = workItems;

      console.log("getWorkItemsForNode");
      console.log({ workItems });

      const children = {};
      for (let i in workItems) {
        const wi = workItems[i];
        children[i] = _.where(workItems, {
          workItemParent: wi.workItemId
        });
        console.log(wi);
        console.log(children[i]);
      }

      // for (let i in Object.keys(children)) {

      // }

      // function createNodeWithChildren(workItem) {
      //   const { workItemId } = workItem;
      //   const childs = children[workItemId];
      //   if (childs.length) {

      //   } else {
      //     return new WorkItemNode(workItem);
      //   }
      // }

      // return workItems.map(wi => new WorkItemNode(wi));
      const workItems_ = workItems.map(wi => new WorkItemNode(wi, []));

      return workItems_;
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
    super(`${workItemComposite.workItemStateIcon} ${workItemComposite.workItemId} ${workItemComposite.workItemTitle}`);

    this.iconPath = vscode.Uri.parse(workItemComposite.workItemIcon);
    this.workItemId = +workItemComposite.workItemId;
    this.workItemType = workItemComposite.workItemType;
    this.editUrl = workItemComposite.url;
    this.contextValue = "work-item";

    const assignedTo = (workItemComposite.workItemAssignedTo || {}).displayName || "Unassigned";
    // this.tooltip = "Open work item in Azure Boards";
    // this.description = workItemComposite.workItemAssignedTo.displayName;
    // this.description = (workItemComposite.workItemAssignedTo || {}).displayName;
    this.description = `${assignedTo}  •  ${workItemComposite.workItemState}`;

    // this.tooltip = workItemComposite.workItemDescription;
    this.tooltip = `${workItemComposite.workItemType}: ${workItemComposite.workItemId} ${workItemComposite.workItemTitle}\nAssigned to: ${assignedTo}\nState: ${workItemComposite.workItemState} `;


    this.data = data;

    const children = this.data.filter((wi = {}) => {
      const { workItemParent } = wi;
      return (workItemParent == this.workItemId);
    });
    if (!children.length) this.collapsibleState = vscode.TreeItemCollapsibleState.None;

    this.command = {
      command: Commands.WorkItemPreview,
      arguments: [workItemComposite],
      title: "Preview"
    };
  }

  async getWorkItemChildren(): Promise<TreeNodeParent[]> {
    try {
      console.log(`getWorkItemChildren: ${this.workItemId} `);
      console.log({ this_: this });
      const children = this.data.filter((wi = {}) => {
        const { workItemParent } = wi;
        return (workItemParent == this.workItemId);
      });
      // return this.data.map(wi => new WorkItemNode(wi));
      return children.map(wi => new WorkItemNode(wi, this.data));
    } catch (e) {
      // track telemetry exception
      trackTelemetryException(e);

      console.error(e);
    }

    return [];
  }
}
