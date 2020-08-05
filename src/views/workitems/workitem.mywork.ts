// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See LICENSE in the project root for license information.

import { IHttpClientResponse } from "azure-devops-node-api/interfaces/common/VsoBaseInterfaces";
import {
  WorkItem,
  WorkItemExpand
} from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
import {
  getCurrentOrganization,
  getCurrentProject
} from "../../configuration/configuration";
import { getWebApiForOrganization } from "../../connection";
import { WorkItemComposite } from "./workitem";
import { WorkItemTypeProvider } from "../../workitems/workitem.icons";
import { trackTelemetryEvent } from "../../util/telemetry";

const _ = require("underscore");

export class MyWorkProvider {
  private workItemTypeProvider = new WorkItemTypeProvider();

  // This should probably be called "getWorkItemsForQuery", and "type" should be "queryId"
  //
  async getMyWorkItems(type: string): Promise<WorkItemComposite[]> {
    const currentOrganization = getCurrentOrganization();
    if (!currentOrganization) {
      return [];
    }

    const currentProject = getCurrentProject();
    if (!currentProject) {
      return [];
    }

    const webApi = await getWebApiForOrganization(currentOrganization);
    const client = webApi.rest.client;
    const url = `${currentOrganization.uri}/${currentProject.name}/_apis/wit/wiql/${type}`;

    const res: IHttpClientResponse = await client.get(url); //needed to call basic client api
    const witApi = await webApi.getWorkItemTrackingApi(); //needed to call wit api

    const body: string = await res.readBody();
    const resp = JSON.parse(body);
    const response = [];

    // If the query is nested / hierarchical, the response will have workItemRelations
    // If flat list, then we get workItems
    // Both are pretty-much the same
    // We don't really care about the hierarchy encoded in the workItemRelations, because
    // we are building the tree view from just the .parent attribute of each item
    //
    if (resp.workItemRelations) {
      for (let r of resp.workItemRelations) {
        response.push(r.target)
      }
    } else {
      for (let r of resp.workItems) {
        response.push(r)
      }
    }

    // const myWorkResponse: IMyWorkResponse = JSON.parse(body);
    const myWorkResponse: IMyWorkResponse = { results: response };

    // get work item icons from work item provider
    const icons = this.workItemTypeProvider
      ? await this.workItemTypeProvider.getIcons()
      : null;

    // get id's
    const workItemIds =
      myWorkResponse.results !== null
        ? myWorkResponse.results.map(x => x.id)
        : [];

    // The above query fetches just Ids and Urls for the work items
    // This query populates all the fields
    // We need the .relations propertly, and it seems we need to use WorkItemExpand.All
    // for that (which also gets all the fields...)
    //
    const workItems: WorkItem[] =
      (await witApi.getWorkItems(
        workItemIds, undefined, undefined,
        WorkItemExpand.All
      )) || [];

    // loop through work items list and map it to temp map collection
    const workItemsMap: { [workItemId: number]: WorkItem } = {};
    workItems.forEach(wi => (workItemsMap[wi.id ? wi.id : -1] = wi));

    // set the order of workitems to match that of returned id's
    const orderedWorkItems: WorkItem[] = workItemIds.map(
      workItemId => workItemsMap[workItemId]
    );

    // The base64 representation of user images
    // We need to fetch these using the webApi, since these require authentication, so we can't
    // just pass a url to the webview...
    //
    const base64s = {};

    for (let wi of orderedWorkItems) {
      const AssignedTo = wi.fields["System.AssignedTo"];
      if (AssignedTo && AssignedTo.imageUrl) {
        let base64 = base64s[AssignedTo.uniqueName] || "";
        if (!base64) {

          // Note: using webApi.rest.client didn't seem to work here, but using the webApi.rest .get method
          // seems to return the data correctly...
          //
          const resp = await webApi.rest.get(AssignedTo.imageUrl);
          if (resp && resp.result) {
            base64 = `data:${resp.result.imageType};base64,${resp.result.imageData}`;
            base64s[AssignedTo.uniqueName] = base64;
          }
        }
        AssignedTo.base64 = base64;
      }
    }

    // Getting the linked branches for a work item is a little messy. 
    // The format of the branch urls is:
    // vstfs:///Git/Ref/80af8dad-aacc-1122-2233-85e619864277%2Fcd9b62b1-9771-aaaa-bbbb-2730fbf73b6e%2FGBbug%2Ftest-bug
    // So it's like:
    //    vstfs:///Git/Ref/
    //    80af8dad-aacc-1122-2233-85e619864277 (org id)
    //    cd9b62b1-9771-aaaa-bbbb-2730fbf73b6e (repo id)
    //    GB (I presume stands for "git branch" or something like that...
    //    bug%2Ftest-bug (the branch name)
    //
    // And the part after "vstfs:///Git/Ref/" is URIEncoded...
    //
    const gitApi = await webApi.getGitApi();
    const branches = {};
    for (let wi of orderedWorkItems) {
      const relations = wi.relations || [];

      // We just pick the first linked branch
      //
      let branch = _.find(relations, (r) => {
        return r.attributes && r.attributes.name === "Branch"
      });
      if (branch) {
        branch = decodeURIComponent(branch.url || "");
        if (!branches[branch]) {
          const idx = branch.indexOf("/GB");
          if (idx !== -1) {
            let branch_name = branch.slice(idx + 3);
            let branch_repo = branch.split("/")[6];
            let branch_ = await gitApi.getBranch(branch_repo, branch_name);
            branches[branch] = branch_;
          }
        }
      }
      wi.workItemBranch = branches[branch] || {};
    }

    // track telemetry event
    trackTelemetryEvent(type);

    // map orderedWorkItems into our composite to include the right icon
    const work_items_composite = orderedWorkItems.map(wi => new WorkItemComposite(wi, icons));
    return work_items_composite;
  }
}

export interface IMyWorkResponse {
  results: IMyWorkResult[];
}

interface IMyWorkResult {
  id: number;
}
