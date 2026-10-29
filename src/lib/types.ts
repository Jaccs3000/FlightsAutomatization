export type TripType = "one_way" | "round_trip";
export type DateMode = "exact" | "flexible";
export type FollowUpStatus = "active" | "paused";
export type FollowUpMode = "standard" | "weekend_escape";
export type RunStatus = "running" | "completed" | "completed_with_matches" | "no_prices" | "failed" | "cancelled" | "skipped_overlap";

export interface FollowUp {
  id: string;
  name: string;
  originIata: string;
  destinationIata: string;
  /** Multiple destinations are used only by weekend-escape follow-ups. */
  destinationIatas?: string[];
  mode?: FollowUpMode;
  lookaheadDays?: number;
  minNoticeHours?: number;
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
  destinationIatas?: string[];
  mode?: FollowUpMode;
  lookaheadDays?: number;
  minNoticeHours?: number;
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
  destinationIata?: string;
  /** Minimum round-trip fare shown for an outbound calendar day, without a selected return date. */
  isCalendarMinimum?: boolean;
  outboundDate: string;
  inboundDate: string | null;
  amount: number | null;
  currency: string | null;
  comparable: boolean;
  meetsThreshold: boolean;
  observedText: string;
  details: string | null;
  flightOptions?: FlightItineraryOption[];
  flightDetailsStatus?: "available" | "unavailable" | "no_matching_flights";
}

export interface FlightItineraryOption {
  outboundAirline: string;
  outboundLogoUrl?: string | null;
  outboundOperatedBy?: string | null;
  inboundAirline: string | null;
  inboundLogoUrl?: string | null;
  inboundOperatedBy?: string | null;
  outboundDepartureTime: string;
  outboundArrivalTime: string;
  inboundDepartureTime: string | null;
  inboundArrivalTime: string | null;
  amount: number;
  currency: string;
  outboundStops: string | null;
  inboundStops: string | null;
  separateTickets: boolean;
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
