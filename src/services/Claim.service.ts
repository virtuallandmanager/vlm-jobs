// Get a list of new claims

import { DynamoDB } from "aws-sdk";
import { claimsTable, docClient, largeQuery, mainTable } from "./Database.service";
import { Giveaway } from "../models/Giveaway.model";
import { Event } from "../models/Event.model";
import { ContractTransaction, ethers } from "ethers";
import dclNft from "../abis/dclNft";
import { Accounting } from "../models/Accounting.model";
import { gasLimits } from "../workers/Claim.worker";

const signer = process.env.GIVEAWAY_WALLET_A_PVT as string;
if (!signer) {
  throw Error("No signer found");
}

const provider = new ethers.providers.AlchemyProvider("matic", process.env.ALCHEMY_API_KEY_MATIC);

const ethersWallet = new ethers.Wallet(signer, provider);

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
      ":status": Giveaway.ClaimStatus.PENDING,
    },
    //filter out claims that have already been processed
    FilterExpression: "#status = :status",
  };

  try {
    const data = await largeQuery(params);
    console.log("data:", data);
    if (!data.length) {
      return [];
    }
    return data as Giveaway.Claim[];
  } catch (err) {
    console.error("Error querying DynamoDB", err);
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
    console.log("data:", data);
    if (!data.length) {
      return [];
    }
    return data as Giveaway.Claim[];
  } catch (err) {
    console.error("Error querying DynamoDB", err);
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
    console.error("Error querying DynamoDB", err);
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
    console.error("Error querying DynamoDB", err);
    throw err;
  }
};

export const getGiveawayClaimById = async (sk: string): Promise<Giveaway.Claim> => {
  const params: DynamoDB.DocumentClient.GetItemInput = {
    TableName: mainTable,
    Key: {
      pk: Giveaway.Claim.pk,
      sk,
    },
  };

  try {
    const data = await docClient.get(params).promise();

    return data.Item as Giveaway.Claim;
  } catch (err) {
    console.error("Error querying DynamoDB", err);
    throw err;
  }
};
export const getGiveawayItemById = async (itemId: string): Promise<Giveaway.Item> => {
  const params: DynamoDB.DocumentClient.GetItemInput = {
    TableName: mainTable,
    Key: {
      pk: Giveaway.Item.pk,
      sk: itemId,
    },
  };

  try {
    const data = await docClient.get(params).promise();

    return data.Item as Giveaway.Item;
  } catch (err) {
    console.error("Error querying DynamoDB", err);
    throw err;
  }
};

export const getGiveawayItems = async (itemIds: string[]): Promise<Giveaway.Item[]> => {
  try {
    if (!itemIds?.length) return [];
    return await Promise.all(itemIds.map(async (itemId) => await getGiveawayItemById(itemId)));
  } catch (err) {
    console.error("Error querying DynamoDB", err);
    throw err;
  }
};

export const findItemsWithSharedContract = (items: Giveaway.Item[]): { [contractAddress: string]: string[] } => {
  // group each item in 'items' by the contractAddress property
  const groupedClaimItems = items.reduce((acc: any, item: Giveaway.Item) => {
    console.log("Processing item:", item); // Add logging

    if (!acc[item.contractAddress]) {
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
export const sendWearables = async (groupedItemIds: { [contractAddress: string]: string[] }, claim: Giveaway.Claim): Promise<{ success: boolean; transaction: ContractTransaction; error?: any }[]> => {
  try {
    return await Promise.all(
      Object.keys(groupedItemIds).map(async (contractAddress) => {
        const nftContract = new ethers.Contract(contractAddress, dclNft, ethersWallet);
        try {
          const estimateGasOptionsResponse = await estimateGasOptions(nftContract, groupedItemIds[contractAddress], claim.to);
          if (!estimateGasOptionsResponse.success || !estimateGasOptionsResponse.options) {
            throw Error(JSON.stringify(estimateGasOptionsResponse));
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const { options } = estimateGasOptionsResponse;
          const mintTransaction = await mintNewWearables(nftContract, groupedItemIds[contractAddress], claim.to, options);
          if (claim.status !== mintTransaction.status) {
            await updateClaimStatus({ ...claim, status: mintTransaction.status });
          }
          return mintTransaction;
        } catch (error: any) {
          const mintedOut = error.code === "UNPREDICTABLE_GAS_LIMIT" && error.reason === "execution reverted: _issueToken: ITEM_EXHAUSTED";
          if (mintedOut && groupedItemIds.length) {
            claim.status = Giveaway.ClaimStatus.PARTIAL_FAILURE;
            await updateClaimStatus(claim);
          } else if (claim.status === Giveaway.ClaimStatus.IN_PROGRESS) {
            claim.status = Giveaway.ClaimStatus.FAILED;
            await updateClaimStatus(claim);
          }
          return { success: false, transaction: error };
        }
      })
    );
  } catch (error) {
    throw error;
  }
};

// Send One Or More Wearables Within The Same Contract
export const estimateGasOptions = async (nftContract: ethers.Contract, itemIds: string[], to: string) => {
  const walletArray = Array(itemIds.length).fill(to);
  try {
    const limits = gasLimits;
    const maxGasPriceUnit = limits?.gas_price ? limits?.gas_price?.unit : "gwei";
    const maxGasPrice = limits?.gas_price ? limits.gas_price.value : 3000;
    const maxGasLimitUnit = limits?.gas_limit ? limits.gas_limit.unit : "gwei";
    const maxGasLimit = limits?.gas_limit ? limits.gas_limit.value : 3000;
    const gasBuffer = limits?.gas_buffer ? limits.gas_buffer.value : 3000;
    console.log("Gas limits:", maxGasPrice);

    const estimatedGasPrice = await provider.getGasPrice();
    const estimatedGasLimit = await nftContract.estimateGas.issueTokens(walletArray, itemIds);
    const gasPrice = estimatedGasPrice && Number(ethers.utils.formatUnits(estimatedGasPrice, "wei")) + gasBuffer;
    const gasLimit = estimatedGasLimit && Number(ethers.utils.formatUnits(estimatedGasLimit, "wei"));
    const convertedGasPrice = estimatedGasPrice && Number(ethers.utils.formatUnits(estimatedGasPrice, maxGasPriceUnit));
    const convertedGasLimit = estimatedGasLimit && Number(ethers.utils.formatUnits(estimatedGasLimit, maxGasLimitUnit));

    const options = { gasPrice, gasLimit };
    console.log("Gas options:", options);

    if (convertedGasPrice > maxGasPrice || convertedGasLimit > maxGasPrice * itemIds.length || convertedGasLimit > maxGasLimit) {
      console.log(`GAS LIMITED! - GAS PRICE: ${convertedGasPrice}| MAX GAS PRICE: ${maxGasPrice} | GAS LIMIT: ${convertedGasLimit} | MAX GAS LIMIT: ${maxGasLimit} `);
      throw Error(JSON.stringify({ success: false, error: "Estimated gas price too high (Prices shown in Wei)", gasPrice, gasLimit }));
    }

    return { success: true, options };
  } catch (error: any | { code: string; reason: string }) {
    console.log(error.code, error.reason);
    return { success: false, error: error?.code, reason: error?.reason };
  }
};

// Send One Or More Wearables Within The Same Contract
export const mintNewWearables = async (nftContract: ethers.Contract, itemIds: string[], to: string, options: { gasPrice: number; gasLimit: number }) => {
  const walletArray = Array(itemIds.length).fill(to);
  try {
    const transaction: ContractTransaction = await nftContract.issueTokens(walletArray, itemIds, options);
    return { success: true, transaction, status: Giveaway.ClaimStatus.IN_PROGRESS };
  } catch (error: any) {
    console.log(error);
    if (error.code === "UNPREDICTABLE_GAS_LIMIT" || error.reason === "execution reverted: _issueToken: ITEM_EXHAUSTED") {
      return { success: false, transaction: error, status: Giveaway.ClaimStatus.FAILED };
    }
    throw { success: false, transaction: error };
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
    UpdateExpression: "ADD #claims :claimCount, SUBTRACT #allocatedCredits :claimCount",
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
    console.error("Error updating DynamoDB", err);
    throw err;
  }
};

// Increase Allocated Credits for Giveaway
export const decreaseCreditAllocationOfGiveaway = async (allocationId: string) => {
  const params: DynamoDB.DocumentClient.UpdateItemInput = {
    TableName: mainTable,
    Key: {
      pk: Accounting.CreditAllocation.pk,
      sk: allocationId,
    },
    UpdateExpression: "SUBTRACT #allocatedCredits :one",
    ExpressionAttributeNames: {
      "#allocatedCredits": "allocatedCredits",
    },
    ExpressionAttributeValues: {
      ":one": 1,
    },
  };

  try {
    await docClient.update(params).promise();
    return { success: true };
  } catch (err) {
    console.error("Error updating DynamoDB", err);
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
    console.error("Error updating DynamoDB", err);
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
    UpdateExpression: "SUBTRACT #claims :number",
    ExpressionAttributeNames: {
      "#claims": "allocated",
    },
    ExpressionAttributeValues: {
      ":claims": claimsCount,
    },
  };

  try {
    await docClient.update(params).promise();
    return { success: true };
  } catch (err) {
    console.error("Error updating DynamoDB", err);
    throw err;
  }
};
