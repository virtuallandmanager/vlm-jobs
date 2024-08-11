import { Job } from "bullmq";
import { DateTime } from "luxon";
import { createAnalyticsAggregates, getAllSceneIds, getAnalyticsActionsForScene, pushAnalyticsAggregatesToDynamoDB, saveDataAsJSON, setTTLForActions } from "../services/Analytics.service";
import { Analytics } from "../models/Analytics.model";

const worker = async (job: Job) => {
  try {
    job.log("Job Started.");
    const startDate = DateTime.fromFormat(job.data.date, "yyyy-MM-dd").startOf("day").toUTC().toMillis(),
      endDate = DateTime.fromFormat(job.data.date, "yyyy-MM-dd").endOf("day").toUTC().toMillis();
    let allAggregates: { minute: Analytics.Aggregate; hour: Analytics.Aggregate; day: Analytics.Aggregate }[] = [];

    const sceneIds: string[] = await getAllSceneIds();

    job.log(`Found ${sceneIds.length} Scene IDs`);

    if (!sceneIds?.length) {
      return {
        success: false,
        message: `No scene IDs found to aggregate data for ${DateTime.now().minus({ days: 1 }).toUTC().toISODate()}`,
      };
    }

    await Promise.all(
      sceneIds.map(async (sceneId, i) => {
        job.log(`Started Getting Analytics Actions for ${sceneId}`);

        await new Promise((resolve) => setTimeout(resolve, 250 * i));
        const analyticsActions = await getAnalyticsActionsForScene({ sceneId, startDate, endDate });
        job.log(`Got ${analyticsActions.length} actions for ${sceneId}`);

        if (analyticsActions.length > 0) {
          job.log(`Started Creating Aggregates for ${sceneId} ${startDate}`);
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
      message: `Created Analytics Aggregates for ${DateTime.fromMillis(startDate).toUTC().toISODate()}`,
      allAggregates,
    };
  } catch (error) {
    job.log(error as string);
    return { message: error };
  }
};

export default worker;
