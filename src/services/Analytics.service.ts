import { DynamoDB } from "aws-sdk";
import { DateTime } from "luxon";
import { analyticsTable, bucketName, docClient, largeQuery, mainTable, s3Client } from "./Database.service";
import { Analytics } from "../models/Analytics.model";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import * as fs from "fs";
import * as path from "path";

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
    const result = await largeQuery(params);

    return result as Analytics.Action[];
  } catch (err) {
    console.error("Error querying DynamoDB", err);
    throw err;
  }
};

export const createAnalyticsAggregates = async (query: Analytics.AggregateQuery) => {
  try {
    const { sceneId, analyticsActions, startDate, endDate } = query;

    const byMinute: Analytics.ActionAggregate = analyticsActions.reduce((acc: Analytics.ActionAggregate, metric) => {
      const { name, ts } = metric;
      const minute = DateTime.fromMillis(ts).startOf("minute").toUTC().toISO({ includeOffset: false });
      if (!minute) return acc;

      if (!acc[name]) {
        acc[name] = { [minute]: 1 };
      }
      if (!acc[name][minute]) {
        acc[name][minute] = 1;
      } else {
        acc[name][minute]++;
      }

      return acc;
    }, {});

    const byHour: Analytics.ActionAggregate = analyticsActions.reduce((acc: Analytics.ActionAggregate, metric) => {
      const { name, ts } = metric;
      const hour = DateTime.fromMillis(ts).startOf("hour").toUTC().toISO({ includeOffset: false });
      if (!hour) return acc;

      if (!acc[name]) {
        acc[name] = { [hour]: 1 };
      }
      if (!acc[name][hour]) {
        acc[name][hour] = 1;
      } else {
        acc[name][hour]++;
      }

      return acc;
    }, {});

    const byDay: Analytics.ActionAggregate = analyticsActions.reduce((acc: Analytics.ActionAggregate, metric) => {
      const { name, ts } = metric;
      const day = DateTime.fromMillis(ts).startOf("day").toUTC().toISO({ includeOffset: false });
      if (!day) return acc;

      if (!acc[name]) {
        acc[name] = { [day]: 1 };
      }
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
  } catch (err) {
    console.error("Error creating analytics aggregates", err);
    throw err;
  }
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
    // console.log("BatchWriteItem succeeded:", data);
    return data;
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
                ttl: DateTime.now().plus({ days: 7 }).toMillis(),
              },
            },
          })),
        },
      };

      const data = await docClient.batchWrite(params).promise();
      // console.log("BatchWriteItem succeeded:", data);
      return data;
    }
    return;
  } catch (err) {
    console.error("Unable to batch write item(s). Error JSON:", JSON.stringify(err, null, 2));
  }
};

// Function to save the analytics data as a JSON file
export const saveDataAsJSON = async (data: any, sceneId: string, date: string): Promise<void> => {
  const jsonData = JSON.stringify(data, null, 2); // Pretty print with indentation
  const fileName = `${sceneId}-${date}.json`;
  const filePath = path.join(__dirname, fileName);

  // Save the JSON file locally
  fs.writeFileSync(filePath, jsonData, "utf-8");
  console.log(`Analytics data saved to ${filePath}`);

  // Upload the file to S3 (optional)
  await uploadToS3(fileName, jsonData);
};

// Function to upload the JSON file to Amazon S3
async function uploadToS3(fileName: string, jsonData: string): Promise<void> {
  const uploadParams = {
    Bucket: bucketName,
    Key: `analytics/${fileName}`,
    Body: jsonData,
    ContentType: "application/json",
  };

  try {
    await s3Client.send(new PutObjectCommand(uploadParams));
    console.log(`Analytics data uploaded to S3: ${fileName}`);
  } catch (err) {
    console.error("Error uploading to S3:", err);
  }
}
