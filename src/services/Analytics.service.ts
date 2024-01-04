import { DynamoDB } from "aws-sdk";
import { DateTime } from "luxon";
import { analyticsTable, docClient, mainTable } from "./Database.service";
import { Analytics } from "../models/Analytics.model";

export const getAllSceneIds = async (): Promise<string[]> => {
  const params: DynamoDB.DocumentClient.QueryInput = {
    TableName: mainTable,
    KeyConditionExpression: "#pk = :pk",
    ExpressionAttributeNames: {
      "#pk": "pk",
    },
    ExpressionAttributeValues: {
      ":pk": "vlm:scene",
    },
  };

  try {
    const data = await docClient.query(params).promise();
    if (!data.Items?.length) {
      return [];
    }
    return data.Items.map((item) => item.sk);
  } catch (err) {
    console.error("Error querying DynamoDB", err);
    throw err;
  }
};

export const getAnalyticsActionsForScene = async (query: { sceneId: string; startDate: EpochTimeStamp; endDate: EpochTimeStamp }) => {
  const { sceneId, startDate, endDate } = query;
  const params: DynamoDB.DocumentClient.QueryInput = {
    TableName: analyticsTable,
    IndexName: "sceneId-index",
    KeyConditionExpression: "pk = :analyticsAggregatePk and sceneId = :sceneId",
    FilterExpression: "#timestamp BETWEEN :startDate AND :endDate",
    ExpressionAttributeNames: {
      "#timestamp": "ts",
    },
    ExpressionAttributeValues: {
      ":analyticsAggregatePk": "vlm:analytics:session:action",
      ":sceneId": sceneId,
      ":startDate": startDate,
      ":endDate": endDate,
    },
  };
  const result = await docClient.query(params).promise();

  return result.Items as Analytics.Action[];
};

export const createAnalyticsAggregates = async (query: { sceneId: string; analyticsActions: Analytics.Action[]; startDate: EpochTimeStamp; endDate: EpochTimeStamp }) => {
  const { sceneId, analyticsActions, startDate, endDate } = query;
  let byMinute = {},
    byHour = {},
    byDay = {},
    actionNames = Array.from(new Set(analyticsActions.map((action) => action.name)));

  // group each metric by the action property and count how many of each action took place during each minute
  byMinute = analyticsActions.reduce((acc: any, metric: Analytics.Action) => {
    const { name, ts } = metric;
    const minute = DateTime.fromMillis(ts).startOf("minute").toISO();
    if (!minute) return acc;
    if (!acc[minute]) {
      acc[minute] = {};
    }
    if (!acc[minute][name]) {
      acc[minute][name] = 0;
    }
    acc[minute][name]++;
    return acc;
  }, {});

  byHour = analyticsActions.reduce((acc: any, metric: Analytics.Action) => {
    const { name, ts } = metric;
    const hour = DateTime.fromMillis(ts).toUTC().startOf("hour").toISO();
    if (!hour) return acc;
    if (!acc[hour]) {
      acc[hour] = {};
    }
    if (!acc[hour][name]) {
      acc[hour][name] = 0;
    }
    acc[hour][name]++;
    return acc;
  }, {});

  byDay = analyticsActions.reduce((acc: any, metric: Analytics.Action) => {
    const { name, ts } = metric;
    const day = DateTime.fromMillis(ts).toUTC().startOf("day").toISO();
    if (!day) return acc;
    if (!acc[day]) {
      acc[day] = {};
    }
    if (!acc[day][name]) {
      acc[day][name] = 0;
    }
    acc[day][name]++;
    return acc;
  }, {});

  const minute = new Analytics.Aggregate({
    sceneId: sceneId,
    startDateTime: startDate,
    endDateTime: endDate,
    actionCounts: byMinute,
    actionNames,
    scale: Analytics.AggregateScale.MINUTE,
  });

  const hour = new Analytics.Aggregate({
    sceneId: sceneId,
    startDateTime: startDate,
    endDateTime: endDate,
    actionCounts: byHour,
    actionNames,
    scale: Analytics.AggregateScale.HOUR,
  });

  const day = new Analytics.Aggregate({
    sceneId: sceneId,
    startDateTime: startDate,
    endDateTime: endDate,
    actionCounts: byDay,
    actionNames,
    scale: Analytics.AggregateScale.DAY,
  });

  return { minute, hour, day };
};

export const pushAnalyticsAggregatesToDynamoDB = async (aggregates: Analytics.Aggregate[]) => {
  const params: DynamoDB.DocumentClient.BatchWriteItemInput = {
    RequestItems: {
      vlm_analytics: aggregates.map((aggregate) => {
        return {
          PutRequest: {
            Item: aggregate,
          },
        };
      }),
    },
  };

  try {
    const data = await docClient.batchWrite(params).promise();
    console.log("BatchWriteItem succeeded:", data);
  } catch (err) {
    console.error("Unable to batch write item(s). Error JSON:", JSON.stringify(err, null, 2));
  }
};

export const setTTLForActions = async function (query: { analyticsActions: Analytics.Action[] }) {
  const { analyticsActions } = query;

  // Function to chunk the array
  const chunkArray = <T>(array: T[], chunkSize: number): T[][] => {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  };

  // Splitting analyticsActions into chunks of 25
  const actionChunks = chunkArray(analyticsActions, 25);

  try {
    // Process each chunk
    for (const chunk of actionChunks) {
      const params: DynamoDB.DocumentClient.BatchWriteItemInput = {
        RequestItems: {
          vlm_analytics: chunk.map((action) => ({
            PutRequest: {
              Item: {
                ...action,
                aggregated: true,
                ttl: DateTime.now().plus({ days: 30 }).toUnixInteger(),
              },
            },
          })),
        },
      };

      const data = await docClient.batchWrite(params).promise();
      console.log("BatchWriteItem succeeded:", data);
    }
  } catch (err) {
    console.error("Unable to batch write item(s). Error JSON:", JSON.stringify(err, null, 2));
  }
};
