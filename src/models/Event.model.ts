import { v4 as uuidv4 } from "uuid";
import { DateTime } from "luxon";
import { Giveaway } from "./Giveaway.model";

export namespace Event {
  export class Config {
    static pk: string = "vlm:event"; // Partition Key
    pk?: string = Config?.pk; // Partition Key
    sk: string = uuidv4(); // Sort Key
    userId?: string;
    name?: string = "New Event";
    description?: string;
    createdAt?: number = DateTime.now().toMillis();
    timeZone?: string = "UTC";
    eventStart: number;
    eventEnd?: number;
    imageSrc?: string;
    location?: string;
    locationUrl?: string;
    worlds?: Array<string>;
    claimLimits?: Giveaway.ClaimLimits = {}; // caps total number of giveaway claims allowed for this event
    ts?: EpochTimeStamp = DateTime.now().toMillis();

    constructor(config: Event.Config) {
      this.sk = config?.sk || this.sk;
      this.userId = config?.userId;
      this.name = config?.name;
      this.description = config?.description;
      this.createdAt = config?.createdAt || this.createdAt;
      this.timeZone = config?.timeZone;
      this.eventStart = config?.eventStart;
      this.eventEnd = config?.eventEnd;
      this.imageSrc = config?.imageSrc;
      this.location = config?.location;
      this.locationUrl = config?.locationUrl;
      this.worlds = config?.worlds;
      this.claimLimits = config?.claimLimits || this.claimLimits;
      this.ts = config?.ts || this.ts;
    }
  }

  export class GiveawayLink {
    static pk: string = "vlm:event:giveaway:link";
    pk: string = GiveawayLink.pk;
    sk: string = uuidv4();
    eventId?: string;
    giveawayId?: string;

    constructor({ eventId, giveawayId, event, giveaway }: { eventId?: string; giveawayId?: string; event?: Config; giveaway?: Giveaway.Config }) {
      this.eventId = eventId || event?.sk;
      this.giveawayId = giveawayId || giveaway?.sk;
    }
  }
}
