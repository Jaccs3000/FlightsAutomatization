export type TripType = "one_way" | "round_trip";
export type DateMode = "exact" | "flexible";
export type FollowUpStatus = "active" | "paused";
export type RunStatus = "running" | "completed" | "completed_with_matches" | "no_prices" | "failed" | "skipped_overlap";

export interface FollowUp {
  id: string;
  name: string;
  originIata: string;
  destinationIata: string;
  tripType: TripType;
  outboundMode: DateMode;
  outboundStart: string;
  outboundEnd: string | null;
  inboundMode: DateMode | null;
  inboundStart: string | null;
  inboundEnd: string | null;
  stayNights: number | null;
  adults: number;
  maxPriceCop: number;
  status: FollowUpStatus;
  createdAt: string;
  updatedAt: string;
}

export interface FollowUpInput {
  name: string;
  originIata: string;
  destinationIata: string;
  tripType: TripType;
  outboundMode: DateMode;
  outboundStart: string;
  outboundEnd?: string | null;
  inboundMode?: DateMode | null;
  inboundStart?: string | null;
  inboundEnd?: string | null;
  stayNights?: number | null;
  adults: number;
  maxPriceCop: number;
  status: FollowUpStatus;
}

export interface AppSettings {
  recipientEmail: string;
  scheduleTimes: string[];
  historyRetentionDays: number;
  senderEmail: string | null;
  schedulerEnabled: boolean;
}

export interface FlightPriceResult {
  outboundDate: string;
  inboundDate: string | null;
  amount: number | null;
  currency: string | null;
  comparable: boolean;
  meetsThreshold: boolean;
  observedText: string;
  details: string | null;
}

export interface RunRecord {
  id: string;
  batchId: string;
  followUpId: string;
  followUpName: string;
  snapshot: FollowUp | null;
  runType: "scheduled" | "manual";
  scheduledAt: string | null;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  resultCount: number;
  notificationStatus: "not_needed" | "sent" | "failed" | "not_configured";
  notificationRecipient: string | null;
  notificationSentAt: string | null;
  notificationError: string | null;
}

export interface RunWithResults extends RunRecord {
  results: FlightPriceResult[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  recipientEmail: "",
  scheduleTimes: ["08:00", "13:00", "21:00"],
  historyRetentionDays: 5,
  senderEmail: null,
  schedulerEnabled: true,
};
