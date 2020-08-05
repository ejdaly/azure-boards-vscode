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

    const baseUrl =
      currentOrganization.uri +
      "/" +
      currentProject.id +
      "/_apis/work/predefinedQueries/";

    // const url = baseUrl + type + "?$top=50&includeCompleted=false";
    // const url = `${currentOrganization.uri}/${currentProject.id}/_apis/work/`;
    // const url = "https://dev.azure.com/vetdrive/vetdrive/_apis/wit/queries/047c9f6c-0393-43e0-bb27-f5502ee84cf4";

    // const baseUrl =
    //   currentOrganization.uri +
    //   "/" +
    //   currentProject.id +
    //   "/_apis/work/teamsettings/iterations/";

    // const url = "https://dev.azure.com/vetdrive/vetdrive/vetdrive Team/_apis/work/teamsettings/iterations/Iteration 1/workitems";

    // const url = "https://dev.azure.com/vetdrive/vetdrive/_apis/work/teamsettings/iterations/482d7695-6e09-420c-9201-3453d1e2d670/workitems";

    // const url = "https://dev.azure.com/vetdrive/vetdrive/vetdrive%20Team/_apis/wit/wiql/a930d01f-0e50-4a6f-95c2-6b6f0a2ae868";
    // const url = "https://dev.azure.com/vetdrive/vetdrive/_apis/wit/wiql/a930d01f-0e50-4a6f-95c2-6b6f0a2ae868";
    const url = "https://dev.azure.com/vetdrive/vetdrive/_apis/wit/wiql/" + type;

    const res: IHttpClientResponse = await client.get(url); //needed to call basic client api
    const witApi = await webApi.getWorkItemTrackingApi(); //needed to call wit api

    const body: string = await res.readBody();
    const resp = JSON.parse(body);
    console.log("resp");
    console.log(resp)
    const response = [];
    if (resp.workItemRelations) {
      for (let r of resp.workItemRelations) {
        response.push(r.target)
      }
    } else {
      for (let r of resp.workItems) {
        response.push(r)
      }
    }

    console.log({ response });

    // const myWorkResponse: IMyWorkResponse = JSON.parse(body);
    const myWorkResponse: IMyWorkResponse = { results: response };
    console.log({ myWorkResponse });

    // get work item icons from work item provider
    const icons = this.workItemTypeProvider
      ? await this.workItemTypeProvider.getIcons()
      : null;

    // get id's
    const workItemIds =
      myWorkResponse.results !== null
        ? myWorkResponse.results.map(x => x.id)
        : [];

    // get work items from id's
    // const workItems: WorkItem[] =
    //   (await witApi.getWorkItems(
    //     workItemIds,
    //     ["System.Id", "System.Title", "System.WorkItemType", "System.Description", "Microsoft.VSTS.Common.AcceptanceCriteria", "System.State", "System.AssignedTo", "Microsoft.VSTS.Scheduling.StoryPoints", "System.Parent", "System.Reason", "System.RelatedLinks", "System.LinkedFiles"],
    //     undefined,
    //     WorkItemExpand.Links
    //   )) || [];

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

    console.log("workitems")
    console.log({ workItems });
    console.log({ orderedWorkItems });

    const base64s = {};

    for (let wi of orderedWorkItems) {
      const AssignedTo = wi.fields["System.AssignedTo"];
      if (AssignedTo && AssignedTo.imageUrl) {
        console.log(AssignedTo.imageUrl);

        let base64 = base64s[AssignedTo.uniqueName] || "";
        if (!base64) {
          // const resp = await client.get(AssignedTo.imageUrl);
          const resp = await webApi.rest.get(AssignedTo.imageUrl);
          console.log({ resp });
          if (resp && resp.result) {
            base64 = `data:${resp.result.imageType};base64,${resp.result.imageData}`;
            console.log({ base64 });
            base64s[AssignedTo.uniqueName] = base64;
          }
        }
        AssignedTo.base64 = base64;
      }
    }

    const gitApi = await webApi.getGitApi();
    const branches = {};
    for (let wi of orderedWorkItems) {
      const relations = wi.relations || [];
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
            console.log("BRANCH_")
            console.log(branch_);
            console.log({ branch_name, branch_repo });
            branches[branch] = branch_;
          }
        }
      }
      wi.workItemBranch = branches[branch] || {};
    }

    // track telemetry event
    trackTelemetryEvent(type);

    // map orderedWorkItems into our composite to include the right icon
    // return orderedWorkItems.map(wi => new WorkItemComposite(wi, icons));

    const work_items_composite = orderedWorkItems.map(wi => new WorkItemComposite(wi, icons));
    console.log({ work_items_composite });
    return work_items_composite;
  }
}

export interface IMyWorkResponse {
  results: IMyWorkResult[];
}

interface IMyWorkResult {
  id: number;
}
