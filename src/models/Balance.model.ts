export type BalanceConfig = {
  id: string;
  userId: string;
  type: BalanceType;
  value: number;
};

export enum BalanceType {
  AIRDROP = "airdrop",
  ATTENDANCE = "attendance",
  ANALYTICS = "analytics",
}

export const InitialBalances = {
  user: [
    { type: BalanceType.AIRDROP, value: 0 },
    { type: BalanceType.ATTENDANCE, value: 0 },
    { type: BalanceType.ANALYTICS, value: 0 },
  ],
  organization: [
    { type: BalanceType.AIRDROP, value: 0 },
    { type: BalanceType.ATTENDANCE, value: 0 },
    { type: BalanceType.ANALYTICS, value: 0 },
  ],
};
