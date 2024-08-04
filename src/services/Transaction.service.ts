import { DynamoDB } from "aws-sdk";
import { Accounting } from "../models/Accounting.model";
import { docClient, transactionsTable } from "./Database.service";

// Get all pending transactions
export const getPendingAirdropTransactions = async (): Promise<Accounting.Transaction[]> => {
  const params: DynamoDB.DocumentClient.QueryInput = {
    TableName: transactionsTable,
    IndexName: "status-index",
    KeyConditionExpression: "#pk = :pk AND #status = :pending",
    ExpressionAttributeNames: {
      "#pk": "pk",
      "#status": "status",
      "#txType": "txType",
    },
    ExpressionAttributeValues: {
      ":pk": Accounting.Transaction.pk,
      ":pending": Accounting.TransactionStatus.PENDING,
      ":txType": Accounting.TransactionType.ITEM_GIVEAWAY,
    },
    FilterExpression: "#txType = :txType",
  };

  try {
    const data = await docClient.query(params).promise();
    if (!data.Items?.length) {
      return [];
    }
    return data.Items as Accounting.Transaction[];
  } catch (err) {
    console.error("Error querying DynamoDB - getPendingAirdropTransactions", err);
    throw err;
  }
};

// Find A Transaction
export const getTransactionById = async (transactionId?: string) => {
  if (!transactionId) {
    return null;
  }
  const params: DynamoDB.DocumentClient.GetItemInput = {
    TableName: transactionsTable,
    Key: {
      pk: Accounting.Transaction.pk,
      sk: transactionId,
    },
  };

  try {
    const data = await docClient.get(params).promise();
    if (!data.Item) {
      return null;
    }
    return data.Item as Accounting.Transaction;
  } catch (err) {
    console.error("Error getting item from DynamoDB - getTransactionById", err);
    throw err;
  }
};

// Update VLM Transaction
export const updateTransaction = async (transaction: Accounting.Transaction) => {
  const params: DynamoDB.DocumentClient.PutItemInput = {
    TableName: transactionsTable,
    Item: transaction,
  };

  try {
    await docClient.put(params).promise();
  } catch (err) {
    console.error("Error putting item on DynamoDB - updateTransaction", err);
    throw err;
  }
};

// Add Blockchain Transaction Ids to VLM Transaction
export const addBlockchainTransactionIds = async (transactionId: string, blockchainTxIds: string[]) => {
  try {
    const transaction = await getTransactionById(transactionId);
    if (!transaction) {
      throw new Error("Transaction not found");
    }
    transaction.blockchainTxIds = blockchainTxIds;
    await updateTransaction(transaction);
    return transaction;
  } catch (err) {
    console.error("Error adding blockchain transaction ids", err);
    throw err;
  }
};

// Mark VLM Transaction as Complete
export const markTransactionAsComplete = async (transactionId: string) => {
  try {
    const transaction = await getTransactionById(transactionId);
    if (!transaction) {
      throw new Error("Transaction not found");
    }
    transaction.status = Accounting.TransactionStatus.COMPLETED;
    await updateTransaction(transaction);
    return transaction;
  } catch (err) {
    console.error("Error marking transaction as complete", err);
    throw err;
  }
};
