import { DateTime } from "luxon";
import { v4 as uuidv4 } from "uuid";

export namespace Analytics {
  export class Action {
    static pk: string = "vlm:analytics:session:action"; // Partition Key
    pk?: string = Action.pk;
    sk?: string = uuidv4(); // Sort Key
    name: string = "Unknown Action";
    sessionId?: string;
    sceneId?: string;
    metadata?: unknown = {};
    aggregated?: boolean = false;
    ts: EpochTimeStamp = DateTime.now().toUnixInteger();

    constructor(config: Action) {
      this.sk = config.sk || this.sk;
      this.name = config.name || this.name;
      this.sessionId = config.sessionId;
      this.sceneId = config.sceneId;
      this.metadata = config.metadata || this.metadata;
      this.aggregated = config.aggregated || this.aggregated;
      this.ts = config.ts || this.ts;
    }
  }

  export class Aggregate {
    static pk: string = "vlm:analytics:aggregate"; // Partition Key
    pk?: string = Aggregate.pk;
    sk?: string = `${DateTime.now().minus({ days: 1 }).startOf("day").toISODate()}:${AggregateScale.MINUTE}`; // Sort Key
    sceneId?: string;
    startDateTime: EpochTimeStamp = DateTime.now().minus({ days: 1 }).startOf("day").toUnixInteger();
    endDateTime: EpochTimeStamp = DateTime.now().minus({ days: 1 }).endOf("day").toUnixInteger();
    actionCounts: ActionAggregate = {};
    actionNames: string[] = [];
    scale?: AggregateScale = AggregateScale.MINUTE;
    ts?: EpochTimeStamp = DateTime.now().toUnixInteger();

    constructor(config: Aggregate) {
      this.sk = DateTime.fromSeconds(config.startDateTime).toUTC().startOf("day").toISODate() + ":" + config.scale;
      this.sceneId = config.sceneId;
      this.startDateTime = config.startDateTime || this.startDateTime;
      this.endDateTime = config.endDateTime || this.endDateTime;
      this.actionCounts = config.actionCounts || this.actionCounts;
      this.actionNames = config.actionNames || this.actionNames;
      this.scale = config.scale || this.scale;
      this.ts = config.ts || this.ts;
    }
  }

  export type ActionAggregate = {
    [isoDateTime: string]: { [count: string]: number };
  };

  export enum AggregateScale {
    MINUTE = "minute",
    HOUR = "hour",
    DAY = "day",
    WEEK = "week",
    MONTH = "month",
    YEAR = "year",
  }
}
