// Get a list of new claims
import { v4 as uuidv4 } from "uuid";
import { DynamoDB } from "aws-sdk";
import { claimsTable, docClient, largeQuery, mainTable, transactionsTable } from "./Database.service";
import { Giveaway } from "../models/Giveaway.model";
import { Event } from "../models/Event.model";
import { ContractTransaction, ethers } from "ethers";
import dclNft from "../abis/dclNft";
import { Accounting } from "../models/Accounting.model";
import { DateTime } from "luxon";

const signer = process.env.GIVEAWAY_WALLET_A_PVT as string;
if (!signer) {
  throw Error("No signer found");
}

const provider = new ethers.providers.AlchemyProvider("matic", process.env.ALCHEMY_API_KEY_MATIC);

export const ethersWallet = new ethers.Wallet(signer, provider);

export class NonceManager {
  private nonce: number;

  constructor(initialNonce: number) {
    this.nonce = initialNonce;
  }

  getNextNonce(): number {
    return this.nonce++;
  }
}

export const getIncompleteClaims = async (): Promise<Giveaway.Claim[]> => {
  const params: DynamoDB.DocumentClient.QueryInput = {
    TableName: claimsTable,
    KeyConditionExpression: "#pk = :pk",
    ExpressionAttributeNames: {
      "#pk": "pk",
      "#status": "status",
    },
    ExpressionAttributeValues: {
      ":pk": Giveaway.Claim.pk,
      ":pending": Giveaway.ClaimStatus.PENDING,
      ":failed": Giveaway.ClaimStatus.FAILED,
    },
    //filter out claims that have already been processed
    FilterExpression: "#status = :pending OR #status = :failed",
  };

  try {
    const data = await largeQuery(params);
    if (!data.length) {
      return [];
    }
    return data as Giveaway.Claim[];
  } catch (err) {
    console.error("Error querying DynamoDB - getIncompleteClaims", err);
    throw err;
  }
};

export const getLastTwoDaysOfClaims = async (): Promise<Giveaway.Claim[]> => {
  const params: DynamoDB.DocumentClient.QueryInput = {
    TableName: claimsTable,
    KeyConditionExpression: "#pk = :pk",
    ExpressionAttributeNames: {
      "#pk": "pk",
      "#status": "status",
    },
    ExpressionAttributeValues: {
      ":pk": Giveaway.Claim.pk,
      ":complete": Giveaway.ClaimStatus.COMPLETE,
      ":ts": DateTime.now().minus({ days: 2 }).toMillis(),
    },
    //filter out claims that have already been processed
    FilterExpression: "#status = :complete AND #ts > :ts",
  };

  try {
    const data = await largeQuery(params);
    if (!data.length) {
      return [];
    }
    return data as Giveaway.Claim[];
  } catch (err) {
    console.error("Error querying DynamoDB - getIncompleteClaims", err);
    throw err;
  }
};

export const obtainUserGiveawayTransactionList = async (giveawayId: string, userId: string): Promise<Giveaway.TransactionList> => {
  let userTransactionList = await getUserGiveawayTransactionList(giveawayId, userId);
  if (userTransactionList) {
    return userTransactionList;
  } else {
    return await createNewUserGiveawayTransactionList(giveawayId, userId);
  }
};

export const createNewUserGiveawayTransactionList = async (giveawayId: string, userId: string): Promise<Giveaway.TransactionList> => {
  const transactionList: Giveaway.TransactionList = new Giveaway.TransactionList({
    sk: uuidv4(),
    userId,
    giveawayId,
    transactionIds: [],
  });

  const params: DynamoDB.DocumentClient.PutItemInput = {
    TableName: transactionsTable,
    Item: transactionList,
  };

  try {
    await docClient.put(params).promise();
    return transactionList;
  } catch (err) {
    console.error("Error querying DynamoDB - createNewUserGiveawayTransactionList", err);
    throw err;
  }
};

export const getUserGiveawayTransactionList = async (giveawayId: string, userId: string): Promise<Giveaway.TransactionList | undefined> => {
  const params: DynamoDB.DocumentClient.QueryInput = {
    TableName: transactionsTable,
    IndexName: "userId-index",
    KeyConditionExpression: "#pk = :pk AND #userId = :userId",
    ExpressionAttributeNames: {
      "#pk": "pk",
      "#userId": "userId",
      "#giveawayId": "giveawayId",
    },
    ExpressionAttributeValues: {
      ":pk": Giveaway.TransactionList.pk,
      ":userId": userId,
      ":giveawayId": giveawayId,
    },
    FilterExpression: "#giveawayId = :giveawayId",
  };

  try {
    const data = await largeQuery(params);
    if (!data.length) {
      return;
    }
    return data[0] as Giveaway.TransactionList;
  } catch (err) {
    console.error("Error querying DynamoDB - getUserGiveawayTransactionList", err);
    throw err;
  }
};

export const updateUserGiveawayTransactionList = async (giveawayId: string, userId: string, txHashs: string[]): Promise<Giveaway.TransactionList> => {
  const userTransactionList = await obtainUserGiveawayTransactionList(giveawayId, userId);

  userTransactionList.transactionIds = [...new Set([...userTransactionList.transactionIds, ...txHashs])];
  const params: DynamoDB.DocumentClient.UpdateItemInput = {
    TableName: mainTable,
    Key: {
      pk: Giveaway.Config.pk,
      sk: giveawayId,
    },
    UpdateExpression: `SET #transactionIds = :new_item`,
    ExpressionAttributeNames: {
      "#transactionIds": "transactionIds",
    },
    ExpressionAttributeValues: {
      ":new_item": userTransactionList.transactionIds,
    },
  };

  try {
    await docClient.update(params).promise();

    return userTransactionList;
  } catch (err) {
    console.error("Error querying DynamoDB - getIncompleteClaims", err);
    throw err;
  }
};

export const getInsufficientCreditClaims = async (): Promise<Giveaway.Claim[]> => {
  const params: DynamoDB.DocumentClient.QueryInput = {
    TableName: claimsTable,
    KeyConditionExpression: "#pk = :pk",
    ExpressionAttributeNames: {
      "#pk": "pk",
      "#status": "status",
    },
    ExpressionAttributeValues: {
      ":pk": Giveaway.Claim.pk,
      ":status": Giveaway.ClaimStatus.INSUFFICIENT_CREDIT,
    },
    //filter down to claims that were insufficient before
    FilterExpression: "#status = :status",
  };

  try {
    const data = await largeQuery(params);
    if (!data.length) {
      return [];
    }
    return data as Giveaway.Claim[];
  } catch (err) {
    console.error("Error querying DynamoDB - getInsufficientCreditClaims", err);
    throw err;
  }
};

// Get Giveaway By Id
export const getEventById = async (eventId: string): Promise<Event.Config> => {
  const params: DynamoDB.DocumentClient.GetItemInput = {
    TableName: mainTable,
    Key: {
      pk: Event.Config.pk,
      sk: eventId,
    },
  };

  try {
    const data = await docClient.get(params).promise();

    return data.Item as Event.Config;
  } catch (err) {
    console.error("Error querying DynamoDB - getEventById", err);
    throw err;
  }
};

// Get Giveaway By Id
export const getGiveawayById = async (giveawayId: string): Promise<Giveaway.Config> => {
  const params: DynamoDB.DocumentClient.GetItemInput = {
    TableName: mainTable,
    Key: {
      pk: Giveaway.Config.pk,
      sk: giveawayId,
    },
  };

  try {
    const data = await docClient.get(params).promise();

    return data.Item as Giveaway.Config;
  } catch (err) {
    console.error("Error querying DynamoDB - getGiveawayById", err);
    throw err;
  }
};

export const getGiveawayClaimById = async (sk: string): Promise<Giveaway.Claim> => {
  const params: DynamoDB.DocumentClient.GetItemInput = {
    TableName: claimsTable,
    Key: {
      pk: Giveaway.Claim.pk,
      sk,
    },
  };

  try {
    const data = await docClient.get(params).promise();

    return data.Item as Giveaway.Claim;
  } catch (err) {
    console.error("Error querying DynamoDB - getGiveawayClaimById", err, sk);
    throw err;
  }
};

export const getGiveawayItemById = async (itemId: string): Promise<Giveaway.Item> => {
  try {
    const params: DynamoDB.DocumentClient.GetItemInput = {
      TableName: mainTable,
      Key: {
        pk: Giveaway.Item.pk,
        sk: itemId,
      },
    };

    const data = await docClient.get(params).promise();

    return data.Item as Giveaway.Item;
  } catch (err) {
    console.error("Error querying DynamoDB - getGiveawayItemById", err, itemId);
    throw err;
  }
};

export const getGiveawayItems = async (itemIds: string[]): Promise<Giveaway.Item[]> => {
  try {
    if (!itemIds?.length) return [];
    return await Promise.all(itemIds.map(async (itemId) => await getGiveawayItemById(itemId)));
  } catch (err) {
    console.error("Error querying DynamoDB - getGiveawayItems", err);
    throw err;
  }
};

export const findItemsWithSharedContract = (items: Giveaway.Item[]): { [contractAddress: string]: string[] } => {
  // group each item in 'items' by the contractAddress property
  const groupedClaimItems = items.reduce((acc: any, item: Giveaway.Item) => {
    if (!item) {
      return acc;
    }

    if (!acc[item?.contractAddress]) {
      acc[item.contractAddress] = [];
    }
    acc[item.contractAddress].push(item);
    return acc;
  }, {});

  // reduce each item to just a tokenId
  const groupedItemIds = Object.keys(groupedClaimItems).reduce((acc: any, contractAddress: string) => {
    acc[contractAddress] = groupedClaimItems[contractAddress].map((item: Giveaway.Item) => item.itemId);
    return acc;
  }, {});

  return groupedItemIds;
};

// Send Wearables For One Claim
export const sendWearables = async (
  groupedItemIds: { [contractAddress: string]: string[] },
  claim: Giveaway.Claim,
  nonceManager: NonceManager
): Promise<{ success: boolean; transaction: ContractTransaction | unknown; error?: any }[]> => {
  try {
    const transactions: { success: boolean; transaction: ContractTransaction | unknown; error?: any }[] = [];

    const groupedItemKeys = Object.keys(groupedItemIds);
    console.log("Grouped item keys:", groupedItemKeys);

    for (let i = 0; i < groupedItemKeys.length; i++) {
      const contractAddress = groupedItemKeys[i];
      const nonce = nonceManager.getNextNonce();
      console.log(`Iteration: ${i}, Contract Address: ${contractAddress}, Nonce: ${nonce}`);

      try {
        console.log(`Before estimateGasOptions: i = ${i}, nonce = ${nonce}`);
        const estimateGasOptionsResponse = await estimateGasOptions(new ethers.Contract(contractAddress, dclNft, ethersWallet), groupedItemIds[contractAddress], claim.to, nonce);
        console.log(`After estimateGasOptions: i = ${i}`);

        if (!estimateGasOptionsResponse.success || !estimateGasOptionsResponse.options) {
          claim.status = Giveaway.ClaimStatus.PENDING;
          await updateClaimStatus(claim);
          continue;
        }

        const { options } = estimateGasOptionsResponse;
        options.nonce = nonce;
        console.log("Nonce should be", options.nonce, i);

        const mintTransaction = await mintNewWearables(new ethers.Contract(contractAddress, dclNft, ethersWallet), groupedItemIds[contractAddress], claim.to, options);
        console.log("Minted transaction", mintTransaction.transaction.hash);
        if (claim.status !== mintTransaction.status) {
          await updateClaimStatus({ ...claim, status: mintTransaction.status });
        }
        transactions.push(mintTransaction);
      } catch (error: any) {
        console.log(`Error caught in loop: i = ${i}, nonce = ${nonce}`, error);
        const mintedOut = error.code === "UNPREDICTABLE_GAS_LIMIT" && error.reason === "execution reverted: _issueToken: ITEM_EXHAUSTED";
        if (mintedOut && groupedItemIds.length) {
          claim.status = Giveaway.ClaimStatus.PARTIAL_FAILURE;
          await updateClaimStatus(claim);
        } else if (claim.status === Giveaway.ClaimStatus.IN_PROGRESS) {
          claim.status = Giveaway.ClaimStatus.FAILED;
          await updateClaimStatus(claim);
        }
        transactions.push({ success: false, transaction: {}, error });
      }
    }

    return transactions;
  } catch (error) {
    console.error("Error sending wearables", error);
    throw error;
  }
};

// Estimate gas prices
export const estimateGasOptions = async (nftContract: ethers.Contract, itemIds: string[], to: string, nonce?: number) => {
  const walletArray = Array(itemIds.length).fill(to);
  try {
    const limits = await getGasLimits("ETH:137");
    const maxGasPriceUnit = limits?.gas_price ? limits?.gas_price?.unit : "gwei";
    const maxGasPrice = limits?.gas_price ? limits.gas_price.value : 3000;
    const maxGasLimitUnit = limits?.gas_limit ? limits.gas_limit.unit : "gwei";
    const maxGasLimit = limits?.gas_limit ? limits.gas_limit.value : 3000;
    const gasBuffer = limits?.gas_buffer ? limits.gas_buffer.value : 3000;

    const estimatedGasPrice = await provider.getGasPrice();
    const estimatedGasLimit = await nftContract.estimateGas.issueTokens(walletArray, itemIds);
    const gasPrice = estimatedGasPrice && Number(ethers.utils.formatUnits(estimatedGasPrice, "wei")) + gasBuffer;
    const gasLimit = estimatedGasLimit && Number(ethers.utils.formatUnits(estimatedGasLimit, "wei")) * itemIds.length;
    const convertedGasPrice = estimatedGasPrice && Number(ethers.utils.formatUnits(estimatedGasPrice, maxGasPriceUnit));
    const convertedGasLimit = estimatedGasLimit && Number(ethers.utils.formatUnits(estimatedGasLimit, maxGasLimitUnit)) * itemIds.length;

    const options = { gasPrice, gasLimit, nonce };
    console.log("Gas options:", options);

    if (convertedGasPrice > maxGasPrice || convertedGasLimit > maxGasPrice * itemIds.length || convertedGasLimit > maxGasLimit) {
      console.log(`GAS LIMITED! - GAS PRICE: ${convertedGasPrice}| MAX GAS PRICE: ${maxGasPrice} | GAS LIMIT: ${convertedGasLimit} | MAX GAS LIMIT: ${maxGasLimit} `);
      return { success: false, error: "Estimated gas price too high (Prices shown in Wei)", gasPrice, gasLimit };
    }

    return { success: true, options };
  } catch (error: any | { code: string; reason: string }) {
    console.log(error.code, error.reason);
    return { success: false, error: error?.code, reason: error?.reason };
  }
};

export const checkIfGasLimited = async () => {
  const limits = await getGasLimits("ETH:137");
  const maxGasPriceUnit = limits?.gas_price ? limits?.gas_price?.unit : "gwei";
  const maxGasPrice = limits?.gas_price ? limits.gas_price.value : 3000;
  const gasBuffer = limits?.gas_buffer ? limits.gas_buffer.value : 3000;

  const estimatedGasPrice = await provider.getGasPrice();
  const gasPrice = estimatedGasPrice && Number(ethers.utils.formatUnits(estimatedGasPrice, "wei")) + gasBuffer;
  const convertedGasPrice = estimatedGasPrice && Number(ethers.utils.formatUnits(estimatedGasPrice, maxGasPriceUnit));

  if (convertedGasPrice && convertedGasPrice > maxGasPrice) {
    console.log(`GAS LIMITED! - GAS PRICE: ${convertedGasPrice}| MAX GAS PRICE: ${maxGasPrice} `);
    return { gasLimited: true, error: "Estimated gas price too high (Prices shown in Wei)", gasPrice };
  }

  return { gasLimited: false };
};

// Send One Or More Wearables Within The Same Contract
export const mintNewWearables = async (nftContract: ethers.Contract, itemIds: string[], to: string, options: { gasPrice: number; gasLimit: number }) => {
  const walletArray = Array(itemIds.length).fill(to);
  try {
    const transaction: ContractTransaction = await nftContract.issueTokens(walletArray, itemIds, options);
    // transaction.wait();
    return { success: true, transaction, status: Giveaway.ClaimStatus.IN_PROGRESS };
  } catch (error: any) {
    console.log("error from mintNewWearables", error.message);
    if (error.code === "UNPREDICTABLE_GAS_LIMIT" || error.reason === "execution reverted: _issueToken: ITEM_EXHAUSTED") {
      return { success: false, transaction: error, status: Giveaway.ClaimStatus.FAILED };
    }
    throw { success: false, transaction: error, status: Giveaway.ClaimStatus.FAILED };
  }
};

// Increase Claim Count Of Giveaway
export const increaseClaimCountOfItems = async (itemIds: string[]) => {
  // Start a transaction
  const transactParams: DynamoDB.DocumentClient.TransactWriteItemsInput = {
    TransactItems: [],
  };

  // Updates for each item
  itemIds.forEach((itemId) => {
    transactParams.TransactItems.push({
      Update: {
        TableName: mainTable,
        Key: {
          pk: Giveaway.Item.pk,
          sk: itemId,
        },
        UpdateExpression: "ADD #claims :one",
        ExpressionAttributeNames: {
          "#claims": "claimCount",
        },
        ExpressionAttributeValues: {
          ":one": 1,
        },
      },
    });
  });

  try {
    await docClient.transactWrite(transactParams).promise();
    return { success: true };
  } catch (err) {
    console.error("Error in transactional update DynamoDB", err);
    throw err;
  }
};

// Increase Claim Count Of Giveaway
export const increaseClaimCountOfGiveaway = async (giveawayId: string, claimCount: number) => {
  const params: DynamoDB.DocumentClient.UpdateItemInput = {
    TableName: mainTable,
    Key: {
      pk: Giveaway.Config.pk,
      sk: giveawayId,
    },
    UpdateExpression: "ADD #claims :claimCount",
    ExpressionAttributeNames: {
      "#claims": "claimCount",
    },
    ExpressionAttributeValues: {
      ":claimCount": claimCount,
    },
  };

  try {
    await docClient.update(params).promise();
    return { success: true };
  } catch (err) {
    console.error("Error updating DynamoDB - increaseClaimCountOfGiveaway", err);
    throw err;
  }
};

// Increase Allocated Credits for Giveaway
export const decreaseCreditAllocationOfGiveaway = async (allocationId: string, claimCount: number) => {
  const params: DynamoDB.DocumentClient.UpdateItemInput = {
    TableName: mainTable,
    Key: {
      pk: Accounting.CreditAllocation.pk,
      sk: allocationId,
    },
    UpdateExpression: "ADD #allocatedCredits :claimCount",
    ExpressionAttributeNames: {
      "#allocatedCredits": "allocatedCredits",
    },
    ExpressionAttributeValues: {
      ":claimCount": -claimCount,
    },
  };

  try {
    await docClient.update(params).promise();
    return { success: true };
  } catch (err) {
    console.error("Error updating DynamoDB - decreaseCreditAllocationOfGiveaway", err);
    throw err;
  }
};

export const getCreditAllocationByGiveawayId = async (giveawayId: string): Promise<Accounting.CreditAllocation | undefined> => {
  const params: DynamoDB.DocumentClient.QueryInput = {
    TableName: mainTable,
    IndexName: "giveawayId-index",
    KeyConditionExpression: "#pk = :pk AND #giveawayId = :giveawayId",
    ExpressionAttributeNames: {
      "#pk": "pk",
      "#giveawayId": "giveawayId",
    },
    ExpressionAttributeValues: {
      ":pk": Accounting.CreditAllocation.pk,
      ":giveawayId": giveawayId,
    },
  };

  try {
    const data = await largeQuery(params);

    if (!data.length) {
      return;
    }

    return data[0] as Accounting.CreditAllocation;
  } catch (err) {
    console.error("Error querying DynamoDB - getCreditAllocationByGiveawayId", err);
    throw err;
  }
};

// Update Claim Status
export const updateClaimStatus = async (claim: Giveaway.Claim) => {
  const params: DynamoDB.DocumentClient.UpdateItemInput = {
    TableName: claimsTable,
    Key: {
      pk: Giveaway.Claim.pk,
      sk: claim.sk,
    },
    UpdateExpression: "SET #status = :status",
    ExpressionAttributeNames: {
      "#status": "status",
    },
    ExpressionAttributeValues: {
      ":status": claim.status,
    },
  };

  try {
    await docClient.update(params).promise();
    return { success: true };
  } catch (err) {
    console.error("Error updating DynamoDB - updateClaimStatus", err);
    throw err;
  }
};

// Get Gas Cost Limits
export const getGasLimits = async (sk: string) => {
  const params: DynamoDB.DocumentClient.UpdateItemInput = {
    TableName: mainTable,
    Key: {
      pk: Accounting.TxLimits.pk,
      sk: sk,
    },
  };

  try {
    const { Item } = await docClient.get(params).promise();
    const record = Item as Accounting.TxLimits;
    return record.limits || { gas_price: { unit: "gwei", value: 0 }, gas_limit: { unit: "wei", value: 0 } };
  } catch (err) {
    console.error("Error getting gas limits from DynamoDB", err);
    throw err;
  }
};

// Send Notification

// Get User's Balance

// Update User's Balance
export const deductAirdropBalance = async (giveawayId: string, claimsCount: number) => {
  const params: DynamoDB.DocumentClient.UpdateItemInput = {
    TableName: mainTable,
    Key: {
      pk: Giveaway.Config.pk,
      sk: giveawayId,
    },
    UpdateExpression: "ADD #claims :number",
    ExpressionAttributeNames: {
      "#claims": "allocated",
    },
    ExpressionAttributeValues: {
      ":claims": -claimsCount,
    },
  };

  try {
    await docClient.update(params).promise();
    return { success: true };
  } catch (err) {
    console.error("Error updating DynamoDB - deductAirdropBalance", err);
    throw err;
  }
};
