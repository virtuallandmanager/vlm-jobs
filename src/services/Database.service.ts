import { S3Client } from "@aws-sdk/client-s3";
import AWS, { DynamoDB } from "aws-sdk";
import { DocumentClient } from "aws-sdk/clients/dynamodb";
import { Job } from "bullmq";

export const mainTable = process.env.NODE_ENV === "development" ? "vlm_main_dev" : "vlm_main";
export const analyticsTable = process.env.NODE_ENV === "development" ? "vlm_analytics_dev" : "vlm_analytics";
export const claimsTable = process.env.NODE_ENV === "development" ? "vlm_claims_dev" : "vlm_claims";
export const transactionsTable = process.env.NODE_ENV === "development" ? "vlm_transactions_dev" : "vlm_transactions";

export let docClient: AWS.DynamoDB.DocumentClient;
export let s3Client: S3Client;

if (process.env.NODE_ENV === "production") {
  AWS.config.update({
    region: process.env.AWS_REGION,
  });
  s3Client = new S3Client({
    region: process.env.AWS_REGION || "us-east-2", // Default region if undefined
  });
} else {
  AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_KEY,
    region: process.env.AWS_REGION,
  });
  s3Client = new S3Client({
    region: process.env.AWS_REGION || "us-east-2", // Default region if undefined
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY || "", // Provide a fallback value or throw an error
      secretAccessKey: process.env.AWS_SECRET_KEY || "", // Provide a fallback value or throw an error
    },
  });
}

export const bucketName = process.env.S3_BUCKET;

docClient = new AWS.DynamoDB.DocumentClient();

export const query = async (job: Job) => {
  const params: DynamoDB.DocumentClient.QueryInput = {
    TableName: job.data.table || mainTable,
    KeyConditionExpression: "#pk = :pk",
    ExpressionAttributeNames: {
      "#pk": "pk",
    },
    ExpressionAttributeValues: {
      ":pk": job.data.pk,
    },
  };

  job.data.filters.forEach((filter: any, i: number) => {
    params.FilterExpression = params.FilterExpression ? `${params.FilterExpression} AND #${filter.field} = :${filter.field}` : `#${filter.field} = :${filter.field}`;
    params.ExpressionAttributeNames![`#${filter.field}`] = filter.field;
    params.ExpressionAttributeValues![`:${filter.field}`] = filter.value;
  });

  try {
    const data = await docClient.query(params).promise();
    console.log("Query results:", data.Items);
    return data.Items;
  } catch (err) {
    console.error("Error querying DynamoDB - query", err);
    throw err;
  }
};

export const largeQuery: CallableFunction = async (params: DocumentClient.QueryInput, options: { cache: boolean } = { cache: false }, allData?: DocumentClient.AttributeMap[]) => {
  if (!allData) {
    allData = [];
  }

  try {
    if (options.cache) {
      var data = await docClient.query(params).promise();
    } else {
      var data = await docClient.query(params).promise();
    }

    if (data && data.Items && data.Items.length > 0) {
      allData = [...allData, ...data.Items];
    }

    if (!params.Limit && data.LastEvaluatedKey) {
      params.ExclusiveStartKey = data.LastEvaluatedKey;
      await new Promise((resolve) => setTimeout(resolve, 250));
      return await largeQuery(params, options, allData);
    } else {
      let finalData = allData;
      return finalData;
    }
  } catch (err) {
    console.error("Error querying DynamoDB - largeQuery", err);
    throw err;
  }
};
