import { Job } from "bullmq";
import { DateTime } from "luxon";
import { createAnalyticsAggregates, getAllSceneIds, getAnalyticsActionsForScene, pushAnalyticsAggregatesToDynamoDB, setTTLForActions } from "../services/Analytics.service";

const worker = async (job: Job) => {
  try {
    job.log("Job Started.");
    const startDate = DateTime.fromFormat(job.data.date, "yyyy-MM-dd").startOf("day").toUTC().toUnixInteger(),
      endDate = DateTime.fromFormat(job.data.date, "yyyy-MM-dd").endOf("day").toUTC().toUnixInteger();
    let allAggregates;

    const sceneIds: string[] = await getAllSceneIds();

    job.log(`Found ${sceneIds.length} Scene IDs`);

    if (!sceneIds?.length) {
      return {
        success: false,
        message: `No scene IDs found to aggregate data for ${DateTime.now().minus({ days: 1 }).toUTC().toISODate()}`,
      };
    }

    await Promise.all([
      sceneIds.forEach(async (sceneId) => {
        job.log(`Started Getting Analytics Actions for ${sceneId}`);

        const analyticsActions = await getAnalyticsActionsForScene({ sceneId, startDate, endDate });

        if (analyticsActions.length > 0) {
          job.log(`Started Creating Aggregates for ${sceneId} ${startDate}`);
        } else {
          job.log(`0 actions to aggregate for ${sceneId} ${startDate}`);
          return {
            success: false,
            message: `0 actions to aggregate for ${sceneId} ${startDate}`,
          };
        }
        job.log(`Started Creating Aggregates for ${sceneId}`);
        const { minute, hour, day } = await createAnalyticsAggregates({ sceneId, analyticsActions, startDate, endDate });
        job.log(`${sceneId} minutes: ${minute}, hour: ${hour}, day: ${day}`);

        const aggregates = { minute, hour, day };
        allAggregates.push(aggregates);
        await pushAnalyticsAggregatesToDynamoDB([minute, hour, day]);
        await setTTLForActions({ analyticsActions });
        job.log(JSON.stringify(aggregates));
      }),
    ]);
    return {
      success: true,
      message: `Created Analytics Aggregates for ${DateTime.fromSeconds(startDate).toUTC().toISODate()}`,
      allAggregates,
    };
  } catch (error) {
    job.log(error as string);
    return { message: error };
  }
};

export default worker;
