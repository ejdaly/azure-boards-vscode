// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See LICENSE in the project root for license information.

import { WorkItem } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
import { WorkItemTypeIcon } from "../../workitems/workitem.icons";

const _ = require("underscore");

export class WorkItemComposite {
  public readonly workItemType: string;
  public readonly workItemId: number;
  public readonly workItemTitle: string;

  public readonly workItemDescription: string;
  public readonly workItemAcceptanceCriteria: string;
  public readonly workItemState: string;
  public readonly workItemAssignedTo: object;
  public readonly workItemStoryPoints: number;
  public readonly workItemParent: number;
  public readonly workItemReason: string;
  public readonly workItemStateIcon: string;
  public readonly workItemBranch: object;

  public readonly workItemIcon: string;
  public readonly url: string;

  private readonly _fallBackIconUrl =
    "https://tfsprodcus3.visualstudio.com/_apis/wit/workItemIcons/icon_book?color=009CCC&v=2";

  constructor(
    workItem: WorkItem,
    workItemTypeIcons: WorkItemTypeIcon[] | null
  ) {
    this.workItemType = workItem.fields
      ? workItem.fields["System.WorkItemType"]
      : "";
    this.workItemId = workItem.fields ? workItem.fields["System.Id"] : -1;
    this.workItemTitle = workItem.fields ? workItem.fields["System.Title"] : "";

    // ["System.Id", "System.Title", "System.WorkItemType", "System.Description", "Microsoft.VSTS.Common.AcceptanceCriteria", "System.State", "System.AssignedTo", "Microsoft.VSTS.Scheduling.StoryPoints", "System.Parent"],

    this.workItemDescription = workItem.fields ? workItem.fields["System.Description"] : "";
    this.workItemAcceptanceCriteria = workItem.fields ? workItem.fields["Microsoft.VSTS.Common.AcceptanceCriteria"] : "";
    this.workItemState = workItem.fields ? workItem.fields["System.State"] : "";
    this.workItemAssignedTo = workItem.fields ? workItem.fields["System.AssignedTo"] : {};
    this.workItemStoryPoints = workItem.fields ? workItem.fields["Microsoft.VSTS.Scheduling.StoryPoints"] : 0;
    this.workItemReason = workItem.fields ? workItem.fields["System.Reason"] : "";
    this.workItemParent = workItem.fields ? workItem.fields["System.Parent"] : -1;

    // this.workItemStateIcon = "⬜";
    // this.workItemStateIcon = "✅";
    // this.workItemStateIcon = "🔳";

    // this.workItemStateIcon = "🔵";
    this.workItemStateIcon = "🟦";
    if (this.workItemState === "Closed") {
      // this.workItemStateIcon = "🟢";
      this.workItemStateIcon = "✅";
    } else if (this.workItemState === "New") {
      // this.workItemStateIcon = "⚫";
      // this.workItemStateIcon = "⚪";
      this.workItemStateIcon = "🔳";
    } else if (this.workItemState === "Resolved") {
      // this.workItemStateIcon = "🟠";
      this.workItemStateIcon = "🟧";
    }

    this.workItemBranch = workItem.workItemBranch;

    //get index of icon from list of available icons for the work item type
    let i = workItemTypeIcons
      ? workItemTypeIcons.findIndex(x => x.type === this.workItemType)
      : 0;

    this.workItemIcon = workItemTypeIcons
      ? workItemTypeIcons[i].url.toString()
      : this._fallBackIconUrl;
    this.url = workItem._links.html.href;
  }
}
