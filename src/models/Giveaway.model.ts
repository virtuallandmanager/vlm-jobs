import { DateTime } from "luxon";
import { v4 as uuidv4 } from "uuid";

export namespace Giveaway {
  export class Config {
    static pk: string = "vlm:event:giveaway";
    pk?: string = Config?.pk;
    sk?: string = uuidv4();
    name?: string = "New Giveaway";
    description?: string = "";
    userId?: string;
    startBuffer?: number = 0;
    endBuffer?: number = 0;
    claimLimits?: ClaimLimits = { total: 0 };
    claimCount?: number = 0;
    eventId?: string;
    paused?: boolean;
    items?: Array<string | Item> = [];
    allocatedCredits?: number = 0;
    createdAt?: number = DateTime.now().toUnixInteger();
    ts?: EpochTimeStamp = DateTime.now().toUnixInteger();

    constructor(config: Partial<Config> = {}) {
      this.sk = config?.sk || this.sk;
      this.name = config?.name || this.name;
      this.description = config?.description;
      this.userId = config?.userId;
      this.startBuffer = config?.startBuffer || this.startBuffer;
      this.endBuffer = config?.endBuffer || this.claimCount;
      this.claimLimits = config?.claimLimits || this.claimLimits;
      this.claimCount = config?.claimCount || this.claimCount;
      this.eventId = config?.eventId;
      this.paused = config?.paused;
      this.allocatedCredits = config?.allocatedCredits || this.allocatedCredits;
      this.items = config?.items || this.items;
      this.createdAt = config?.createdAt;
      this.ts = config?.ts;

      if (config?.items && config.items.length) {
        this.items = config.items.map((item) => {
          if (typeof item === "string") {
            return item;
          } else {
            return new Item(item);
          }
        });
      }
    }
  }

  export type ClaimLimits = {
    total?: number;
    hourly?: number;
    daily?: number;
    weekly?: number;
    monthly?: number;
    yearly?: number;
    perUser?: number;
    perIp?: number;
  };

  export class Claim {
    static pk: string = "vlm:event:giveaway:claim";
    pk?: string = Claim.pk;
    sk?: string = uuidv4();
    to: string;
    userId?: string;
    clientIp: string;
    sceneId: string;
    eventId: string;
    giveawayId: string;
    transactionId: string;
    claimTs?: number;
    status?: ClaimStatus = ClaimStatus.PENDING;
    analyticsRecordId: string;
    ts?: EpochTimeStamp = DateTime.now().toUnixInteger();

    constructor(config: Claim) {
      this.sk = config?.sk || this.sk;
      this.to = config?.to;
      this.userId = config?.userId;
      this.clientIp = config?.clientIp;
      this.eventId = config?.eventId;
      this.giveawayId = config?.giveawayId;
      this.sceneId = config?.sceneId;
      this.transactionId = config?.transactionId;
      this.claimTs = config?.claimTs || this.ts;
      this.status = config?.status || this.status;
      this.analyticsRecordId = config?.analyticsRecordId;
      this.ts = config?.ts || this.ts;
    }
  }

  export class Item {
    static pk: string = "vlm:event:giveaway:item";
    pk?: string = Item.pk;
    sk?: string = uuidv4();
    name?: string;
    chain?: number | string = 137;
    contractAddress: string;
    itemId: number | string;
    claimLimits?: ClaimLimits = { total: 0, perUser: 1, perIp: 3 };
    claimCount?: number;
    rarity?: string;
    category?: string;
    imageSrc?: string;
    ts?: EpochTimeStamp = DateTime.now().toUnixInteger();

    constructor(config: Item) {
      this.sk = config?.sk || this.sk;
      this.name = config?.name;
      this.chain = config?.chain;
      this.contractAddress = config?.contractAddress;
      this.itemId = config?.itemId;
      this.claimLimits = config?.claimLimits || this.claimLimits;
      this.claimCount = config?.claimCount || 0;
      this.rarity = config?.rarity;
      this.category = config?.category;
      this.imageSrc = config?.imageSrc;
      this.ts = config?.ts;
    }
  }

  export class ClaimResponse {
    static pk: string = "vlm:event:giveaway:claim:response";
    pk?: string = ClaimResponse.pk;
    sk?: string = uuidv4();
    headline?: string;
    message?: string;
    messageOptions?: MessageOptions;
    type: ClaimResponseType;
    reason?: ClaimRejection;
    ts?: EpochTimeStamp = DateTime.now().toUnixInteger();

    constructor(config: ClaimResponse) {
      this.sk = config?.sk || this.sk;
      this.headline = config?.headline;
      this.type = config?.type;
      this.message = config?.message;
      this.messageOptions = config?.messageOptions;
      this.ts = config?.ts;
    }
  }

  export enum ClaimStatus {
    PENDING = "pending",
    QUEUED = "queued",
    IN_PROGRESS = "in_progress",
    INSUFFICIENT_CREDIT = "insufficient_credit",
    COMPLETE = "complete",
    PARTIAL_FAILURE = "partial_failure",
    FAILED = "failed",
  }

  export enum ClaimRejection {
    PAUSED = "paused",
    BEFORE_EVENT_START = "before_event_start",
    AFTER_EVENT_END = "after_event_end",
    EXISTING_WALLET_CLAIM = "existing_wallet_claim",
    SUPPLY_DEPLETED = "supply_depleted",
    INAUTHENTIC = "inauthentic",
    SUSPICIOUS = "suspicious",
    NO_LINKED_EVENTS = "no_linked_events",
    OVER_IP_LIMIT = "over_ip_limit",
    OVER_DAILY_LIMIT = "over_daily_limit",
    OVER_WEEKLY_LIMIT = "over_weekly_limit",
    OVER_MONTHLY_LIMIT = "over_monthly_limit",
    OVER_YEARLY_LIMIT = "over_yearly_limit",
    OVER_LIMIT = "over_limit",
  }

  export enum ClaimResponseType {
    CLAIM_ACCEPTED = "claim_accepted",
    CLAIM_DENIED = "claim_denied",
    CLAIM_IN_PROGRESS = "claim_in_progress",
    CLAIM_SERVER_ERROR = "claim_server_error",
  }

  type MessageOptions = {
    color: string;
    fontSize: number;
  };

  export interface SetMinterRequest {
    contracts: string[];
    ids: number[];
    minter: string;
  }
}
