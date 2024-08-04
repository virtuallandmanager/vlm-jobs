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
  try {
    const { sceneId, startDate, endDate } = query;
    const params: DynamoDB.DocumentClient.QueryInput = {
      TableName: analyticsTable,
      IndexName: "sceneId-index",
      KeyConditionExpression: "pk = :analyticsActionPk and sceneId = :sceneId",
      FilterExpression: "#timestamp BETWEEN :startDate AND :endDate",
      ExpressionAttributeNames: {
        "#timestamp": "ts",
      },
      ExpressionAttributeValues: {
        ":analyticsActionPk": "vlm:analytics:session:action",
        ":sceneId": sceneId,
        ":startDate": startDate,
        ":endDate": endDate,
      },
    };
    const result = await docClient.query(params).promise();

    return result.Items as Analytics.Action[];
  } catch (err) {
    console.error("Error querying DynamoDB", err);
    throw err;
  }
};

export const createAnalyticsAggregates = async (query: Analytics.AggregateQuery) => {
  const { sceneId, analyticsActions, startDate, endDate } = query;

  const byMinute: Analytics.ActionAggregate = analyticsActions.reduce((acc: Analytics.ActionAggregate, metric) => {
    const { name, ts } = metric;
    const minute = DateTime.fromMillis(ts).startOf("minute").toISO();
    if (!minute) return acc;

    if (!acc[name][minute]) {
      acc[name][minute] = 1;
    } else {
      acc[name][minute]++;
    }

    return acc;
  }, {});

  const byHour: Analytics.ActionAggregate = analyticsActions.reduce((acc: Analytics.ActionAggregate, metric) => {
    const { name, ts } = metric;
    const hour = DateTime.fromMillis(ts).startOf("hour").toISO();
    if (!hour) return acc;

    if (!acc[name][hour]) {
      acc[name][hour] = 1;
    } else {
      acc[name][hour]++;
    }

    return acc;
  }, {});

  const byDay: Analytics.ActionAggregate = analyticsActions.reduce((acc: Analytics.ActionAggregate, metric) => {
    const { name, ts } = metric;
    const day = DateTime.fromMillis(ts).startOf("day").toISO();
    if (!day) return acc;

    if (!acc[name][day]) {
      acc[name][day] = 1;
    } else {
      acc[name][day]++;
    }

    return acc;
  }, {});

  const minuteAggregate = new Analytics.Aggregate({
    sceneId: sceneId,
    startDateTime: startDate,
    endDateTime: endDate,
    actionCounts: byMinute,
    scale: Analytics.AggregateScale.MINUTE,
  });

  console.log(minuteAggregate);

  const hourAggregate = new Analytics.Aggregate({
    sceneId: sceneId,
    startDateTime: startDate,
    endDateTime: endDate,
    actionCounts: byHour,
    scale: Analytics.AggregateScale.HOUR,
  });

  const dayAggregate = new Analytics.Aggregate({
    sceneId: sceneId,
    startDateTime: startDate,
    endDateTime: endDate,
    actionCounts: byDay,
    scale: Analytics.AggregateScale.DAY,
  });

  console.log(`{ minute: ${minuteAggregate}, hour: ${hourAggregate}, day: ${dayAggregate} }`);

  return { minute: minuteAggregate, hour: hourAggregate, day: dayAggregate };
};

export const pushAnalyticsAggregatesToDynamoDB = async (aggregates: Analytics.Aggregate[]) => {
  const params: DynamoDB.DocumentClient.BatchWriteItemInput = {
    RequestItems: {
      [analyticsTable]: aggregates.map((aggregate) => {
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
          [analyticsTable]: chunk.map((action) => ({
            PutRequest: {
              Item: {
                ...action,
                aggregated: true,
                ttl: DateTime.now().plus({ days: 7 }).toUnixInteger(),
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
