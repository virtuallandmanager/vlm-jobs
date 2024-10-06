import { Job } from "bullmq";
import { DateTime } from "luxon";
import {
  createAnalyticsAggregates,
  getAllSceneIds,
  getAnalyticsActionsForScene,
  getSceneData,
  pushAnalyticsAggregatesToDynamoDB,
  saveDataAsJSON,
  setTTLForActions,
} from "../services/Analytics.service";
import { Analytics } from "../models/Analytics.model";

const worker = async (job: Job) => {
  try {
    if (!job.data.date) {
      job.data.date = DateTime.now().minus({ days: 1 }).toISODate();
    }
    job.log("Job Started - Create Daily Analytics Aggregate");
    job.log(`Creating Analytics Aggregates for ${job.data.date}`);
    const startDate = DateTime.fromFormat(job.data.date, "yyyy-MM-dd", { zone: "utc" }).startOf("day").toMillis(),
      endDate = DateTime.fromFormat(job.data.date, "yyyy-MM-dd", { zone: "utc" }).endOf("day").toMillis();
    let allAggregates: { minute: Analytics.Aggregate; hour: Analytics.Aggregate; day: Analytics.Aggregate }[] = [];

    const sceneIds: string[] = await getAllSceneIds();

    job.log(`Found ${sceneIds.length} Scene IDs`);

    if (!sceneIds?.length) {
      return {
        success: false,
        message: `No scene IDs found to aggregate data for ${DateTime.now().toUTC().minus({ days: 1 }).toISODate()}`,
      };
    }
    const scenesAggregated: { name: string; sk: string }[] = [];
    await Promise.all(
      sceneIds.map(async (sceneId, i) => {
        job.log(`Started Getting Analytics Actions for ${sceneId}`);
        await new Promise((resolve) => setTimeout(resolve, 250 * i));
        const analyticsActions = await getAnalyticsActionsForScene({ sceneId, startDate, endDate });
        job.log(`Got ${analyticsActions.length} actions for ${sceneId}`);

        if (analyticsActions.length > 0) {
          job.log(`Started Creating Aggregates for ${sceneId} ${startDate}`);
          const scene = await getSceneData(sceneId);
          if (!scene) return;
          scenesAggregated.push(scene);
        } else {
          return;
        }
        job.log(`Started Creating Aggregates for ${sceneId}`);
        const { minute, hour, day } = await createAnalyticsAggregates({ sceneId, analyticsActions, startDate, endDate });
        job.log(`${sceneId} minutes: ${minute}, hour: ${hour}, day: ${day}`);

        const aggregates = { minute, hour, day };
        allAggregates.push(aggregates);
        await pushAnalyticsAggregatesToDynamoDB([minute, hour, day]);
        await setTTLForActions({ analyticsActions });
        await saveDataAsJSON(analyticsActions, sceneId, job.data.date);
        return;
      })
    );

    return {
      success: true,
      message: `Successfully created aggregate analytics for ${scenesAggregated.length} scenes:\n
      Scenes:\n
      ${scenesAggregated.map((scene) => `${scene.name} (${scene.sk})`).join("\n")}\n
      Date Aggregated: ${DateTime.fromMillis(startDate).toUTC().toISODate()}`,
      allAggregates,
    };
  } catch (error) {
    job.log(error as string);
    return { message: error };
  }
};

export default worker;
