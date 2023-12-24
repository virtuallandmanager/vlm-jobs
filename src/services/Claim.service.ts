// Get a list of new claims

import { DynamoDB } from "aws-sdk";
import { claimsTable, docClient, largeQuery, mainTable } from "./Database.service";
import { Giveaway } from "../models/Giveaway.model";
import { ethers } from "ethers";
import dclNft from "../abis/dclNft";

const signer = process.env.GIVEAWAY_WALLET_A_PVT as string;

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
    FilterExpression: "#complete = :incomplete",
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
export const sendWearables = async (groupedItemIds: { [contractAddress: string]: string[] }, claim: Giveaway.Claim) => {
  return await Promise.all(
    Object.keys(groupedItemIds).map(async (contractAddress) => {
      const nftContract = new ethers.Contract(contractAddress, dclNft, ethersWallet);
      try {
        const mintTransaction = await mintNewWearables(nftContract, groupedItemIds[contractAddress], claim.to);
        return mintTransaction;
      } catch (error) {
        console.log(error);
      }
    })
  );
};

// Send One Or More Wearables Within The Same Contract
export const mintNewWearables = async (nftContract: ethers.Contract, itemIds: string[], to: string) => {
  const walletArray = Array(itemIds.length).fill(to);
  try {
    const estimatedGasPrice = await provider.getGasPrice();
    const estimatedGasLimit = await nftContract.estimateGas.issueTokens(walletArray, itemIds);
    const gasPrice = Number(ethers.utils.formatUnits(estimatedGasPrice, "wei"));
    const gasLimit = Number(ethers.utils.formatUnits(estimatedGasLimit, "wei"));
    const options = { gasPrice, gasLimit };

    if (Number(ethers.utils.formatUnits(estimatedGasPrice, "gwei")) > 3000) {
      return { success: false, error: "Estimated gas price too high" };
    }

    // const transaction = await nftContract.issueTokens(walletArray, itemIds, options);

    // Log transaction hash to console
    // console.log(transaction.hash);

    return { success: true, options };
  } catch (error) {
    console.log(error);
    return { success: false, error };
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
export const increaseClaimCountOfGiveaway = async (giveawayId: string) => {
  const params: DynamoDB.DocumentClient.UpdateItemInput = {
    TableName: mainTable,
    Key: {
      pk: Giveaway.Config.pk,
      sk: giveawayId,
    },
    UpdateExpression: "ADD #claims :one",
    ExpressionAttributeNames: {
      "#claims": "claimCount",
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
    UpdateExpression: "SET #complete = :complete",
    ExpressionAttributeNames: {
      "#complete": "complete",
    },
    ExpressionAttributeValues: {
      ":complete": true,
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

// Send Notification

// Get User's Balance


// Update User's Balance
