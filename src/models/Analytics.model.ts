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
    ts: EpochTimeStamp = DateTime.now().toMillis();

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
    startDateTime: EpochTimeStamp = DateTime.now().toUTC().minus({ days: 1 }).startOf("day").toMillis();
    endDateTime: EpochTimeStamp = DateTime.now().toUTC().minus({ days: 1 }).endOf("day").toMillis();
    actionCounts: ActionAggregate = {};
    scale?: AggregateScale = AggregateScale.MINUTE;
    ts?: EpochTimeStamp = DateTime.now().toMillis();

    constructor(config: Aggregate) {
      this.pk = config.pk || this.pk;
      this.sceneId = config.sceneId;
      this.sk = `${this.sceneId}:${DateTime.fromMillis(config.startDateTime).toUTC().startOf("day").toISODate()}:${config.scale}`;
      this.startDateTime = config.startDateTime || this.startDateTime;
      this.endDateTime = config.endDateTime || this.endDateTime;
      this.actionCounts = config.actionCounts || this.actionCounts;
      this.scale = config.scale || this.scale;
      this.ts = config.ts || this.ts;
    }
  }

  export interface ActionAggregate {
    [actionName: string]: ActionTimeline;
  }

  export interface ActionTimeline {
    [timestamp: string]: number;
  }

  export interface AggregateQuery {
    sceneId: string;
    analyticsActions: Analytics.Action[];
    startDate: EpochTimeStamp;
    endDate: EpochTimeStamp;
  }

  export enum AggregateScale {
    MINUTE = "minute",
    HOUR = "hour",
    DAY = "day",
    WEEK = "week",
    MONTH = "month",
    YEAR = "year",
  }
}
