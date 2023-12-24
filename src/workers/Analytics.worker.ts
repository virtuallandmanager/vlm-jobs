import { Job } from "bullmq";
import { DateTime } from "luxon";
import { createAnalyticsAggregates, getAllSceneIds, getAnalyticsActionsForScene, pushAnalyticsAggregatesToDynamoDB, setTTLForActions } from "../services/Analytics.service";

const worker = async (job: Job) => {
  const startDate = DateTime.fromSeconds(job.data.date).startOf("day").toUTC().toUnixInteger(),
    endDate = DateTime.fromSeconds(job.data.date).endOf("day").toUTC().toUnixInteger();
  let aggregates;

  const sceneIds: string[] = await getAllSceneIds();
  if (!sceneIds?.length) {
    return {
      success: false,
      message: `No scene IDs found to aggregate data for ${DateTime.now().minus({ days: 1 }).toUTC().toISODate()}`,
    };
  }

  await Promise.all([
    sceneIds.forEach(async (sceneId) => {
      const analyticsActions = await getAnalyticsActionsForScene({ sceneId, startDate, endDate });

      if (!analyticsActions?.length) return;

      const { minute, hour, day } = await createAnalyticsAggregates({ sceneId, analyticsActions, startDate, endDate });
      aggregates = { minute, hour, day };
      await pushAnalyticsAggregatesToDynamoDB([minute, hour, day]);
      await setTTLForActions({ analyticsActions });
    }),
  ]);

  return {
    success: true,
    message: `Created Analytics Aggregates for ${DateTime.fromSeconds(startDate).toUTC().toISODate()}`,
    aggregates,
  };
};

export default worker;
