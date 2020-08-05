// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See LICENSE in the project root for license information.

import { WorkItem } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
import { WorkItemTypeIcon } from "../../workitems/workitem.icons";

export class WorkItemComposite {
  public readonly workItemType: string;
  public readonly workItemId: number;
  public readonly workItemTitle: string;

  // This will come back as HTML string. We display it as HTML, but allow it to be edited as markdown
  // and converted back to HTML and saved again...
  //
  public readonly workItemDescription: string;

  // Not used yet - description is fine for now...
  // Note: by default, Bugs have "steps to reproduce" instead of description - but updated the
  // form in Boards to just use Description also...
  //
  // public readonly workItemAcceptanceCriteria: string;


  public readonly workItemState: string;
  public readonly workItemReason: string;

  // This isn't really an icon / image, but a UTF-8 character that looks like an icon
  // Use these for the "checkbox"-style in the tree view
  //
  public readonly workItemStateIcon: string;

  public readonly workItemAssignedTo: object;
  public readonly workItemStoryPoints: number;
  public readonly workItemParent: number;

  // We query for all linked branches, but only associate the first one found with the Work Item
  // (so if more than one, you would only see the first...)
  //
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

    this.workItemDescription = workItem.fields ? workItem.fields["System.Description"] : "";
    // this.workItemAcceptanceCriteria = workItem.fields ? workItem.fields["Microsoft.VSTS.Common.AcceptanceCriteria"] : "";
    this.workItemState = workItem.fields ? workItem.fields["System.State"] : "";
    this.workItemAssignedTo = workItem.fields ? workItem.fields["System.AssignedTo"] : {};
    this.workItemStoryPoints = workItem.fields ? workItem.fields["Microsoft.VSTS.Scheduling.StoryPoints"] : 0;
    this.workItemReason = workItem.fields ? workItem.fields["System.Reason"] : "";
    this.workItemParent = workItem.fields ? workItem.fields["System.Parent"] : -1;

    // In web app - these are displayed as circles, of similar colours to what we have here
    // But boxes look a bit better in the tree view (gives a TODO-list feel...)
    // Note: for some reason Azure defaults Bugs to orange when they are Resolved (but not closed)
    // but Stories stay blue until closed (then green). For consistency (and since these are hardcoded here...)
    // just using orange always for Resolved.
    //
    this.workItemStateIcon = "🟦";
    if (this.workItemState === "Closed") {
      this.workItemStateIcon = "✅";
    } else if (this.workItemState === "New") {
      this.workItemStateIcon = "🔳";
    } else if (this.workItemState === "Resolved") {
      this.workItemStateIcon = "🟧";
    }

    // workItems don't have this property, but we just patch it on for convenience
    // Could pass it into the constructor as a parameter there I guess...?
    //
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
