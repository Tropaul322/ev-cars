export type Language = "de" | "en";
export type VehicleCondition = "new" | "used";
export type ChargingAccess = "home" | "work" | "public" | "none" | "unknown";
export type TripNeed = "city" | "commute" | "road_trip" | "family" | "winter";
export type Importance = "low" | "medium" | "high";

export type QualitativeSignal =
  | "premium"
  | "low_mileage"
  | "good_battery_health"
  | "reliable"
  | "road_trip_comfort"
  | "fast_charging"
  | "good_value"
  | "safety"
  | "technology"
  | "public_charging_fit";

export type MissingCriteria = "budget" | "use_case" | "charging_or_range" | "vehicle_preferences";
export type KnowledgeTopic =
  | "review"
  | "technical_spec"
  | "austrian_incentive"
  | "charging_network"
  | "general";

export type Feature =
  | "apple_carplay"
  | "android_auto"
  | "blind_spot_detection"
  | "adaptive_cruise_control"
  | "lane_keeping_assist"
  | "wireless_charging"
  | "reliable_connectivity"
  | "voice_assistant"
  | "cabin_storage"
  | "heated_seats"
  | "large_trunk"
  | "premium_audio"
  | "heat_pump"
  | "awd";

export type BodyType =
  | "compact"
  | "hatchback"
  | "sedan"
  | "suv"
  | "crossover"
  | "wagon"
  | "van"
  | "other"
  | "minibus";

export type InventorySource =
  | "seed"
  | "willhaben"
  | "autoscout24"
  | "autoscout24_at"
  | "gebrauchtwagen"
  | "gebrauchtwagen_at"
  | "bmw_boerse_at"
  | "vw_austria_ev_leasing"
  | "oem";

export type VehicleSellerType = "dealer" | "private" | "oem" | "unknown";

export type VehicleImage = {
  url: string;
  width?: number | null;
  height?: number | null;
  source?: string;
};

export type Vehicle = {
  id: string;
  source: InventorySource;
  provenance?: string;
  sourceListingId?: string;
  dedupeKey?: string;
  inventoryFingerprint?: string;
  market: "AT";
  listingCountry?: "AT";
  currency?: "EUR";
  title?: string;
  brand?: string;
  make: string;
  model: string;
  trim: string;
  year: number;
  priceEUR: number;
  priceLabel?: string;
  monthlyLeaseEUR: number | null;
  leasingEligible?: boolean | null;
  leaseDurationMonths?: number | null;
  leaseAdvancePaymentEUR?: number | null;
  leaseResidualValueEUR?: number | null;
  leaseDetails?: string | null;
  condition: VehicleCondition;
  mileageKm: number | null;
  rangeKm: number;
  efficiencyKwhPer100Km: number;
  batteryKwh: number;
  batterySoH: number | null;
  chargingCycles: number | null;
  warranty: string;
  bodyType: BodyType;
  seats: number;
  cargoLiters: number;
  drivetrain: "FWD" | "RWD" | "AWD";
  powerKw: number;
  available: boolean;
  features: Feature[];
  images: string[];
  imageDetails?: VehicleImage[];
  location?: string | null;
  listingUrl?: string;
  sellerName?: string | null;
  sellerType?: VehicleSellerType;
  vin?: string | null;
  vatDeductible?: boolean | null;
  sourceUpdatedAt?: string | null;
  crawledAt?: string;
  firstRegistration?: string | null;
  exteriorColor?: string | null;
  doors?: number | null;
  transmission?: string | null;
  manufacturerCountry?: string;
  manufacturerCountryCode?: string;
  notes: string;
  brandOrigin: "europe" | "china" | "korea" | "us" | "other";
  reviewTags: string[];
  raw?: unknown;
};

export type BrandOrigin = Vehicle["brandOrigin"];

export type UserCriteria = {
  language: Language;
  budgetMaxEUR: number | null;
  monthlyBudgetEUR: number | null;
  dailyKm: number | null;
  rangeFloorKm: number | null;
  mileageMaxKm: number | null;
  mileageTargetKm: number | null;
  batterySoHMin: number | null;
  batteryHealthRequired: boolean;
  tripNeeds: TripNeed[];
  chargingAccess: ChargingAccess;
  passengers: number | null;
  cargoNeeds: "low" | "medium" | "high" | null;
  preferredCondition: VehicleCondition | "any";
  bodyTypes: BodyType[];
  brandPreferences: string[];
  preferredBrandOrigins: BrandOrigin[];
  modelPreferences: string[];
  avoidedBrands: string[];
  brandFit: Importance;
  reliabilityImportance: Importance;
  mustHaveFeatures: Feature[];
  qualitativeSignals: QualitativeSignal[];
  location: string | null;
  rawPrompt: string;
};

export type ScoringBreakdown = {
  priceFit: number;
  rangeFit: number;
  efficiencyFit: number;
  tcoFit: number;
  brandFit: number;
  cargoPassengerFit: number;
  reliabilityFit: number;
  featureFit: number;
  personaFit: number;
  batteryHealthFit: number;
  semanticFit: number;
};

export type TcoBreakdown = {
  purchasePriceWithVAT: number;
  incentivesApplied: number;
  estimatedEnergyCostMonthly: number;
  estimatedMonthlyTotal: number;
  leaseMonthly: number | null;
  annualKmAssumption: number;
  electricityPriceEurPerKwh: number;
  assumptionsVersion: string;
  incentiveNote: string;
};

export type RagEvidence = {
  sourceType: "vehicle_payload" | "knowledge_document" | "knowledge_chunk";
  sourceId: string;
  title: string;
  sourceUrl?: string;
  excerpt: string;
  score: number;
  topic?: KnowledgeTopic;
};

export type RagContext = {
  query: string;
  documents: RagEvidence[];
  vehicleEvidence: Record<string, RagEvidence[]>;
  vehicleScores: Record<string, number>;
  topicAffinity: Partial<Record<KnowledgeTopic, number>>;
};

export type MatchResult = {
  vehicle: Vehicle;
  score: number;
  ragScore: number;
  ragEvidence: RagEvidence[];
  hardFilterStatus: "passed";
  scoringBreakdown: ScoringBreakdown;
  explanation: string;
  ruledOutReasons: string[];
  tco: TcoBreakdown;
};

export type RejectedVehicle = {
  vehicle: Vehicle;
  reasons: string[];
};

export type RejectedSummary = {
  reason: string;
  count: number;
};

export type MatchResponse =
  | {
      type: "chat";
      sessionId: string;
      assistantMessage: string;
      message: string;
      criteria: UserCriteria;
      missingCriteria: MissingCriteria[];
      recommendations: [];
      ragCitations: RagEvidence[];
      rejectedSummary: RejectedSummary[];
    }
  | {
      type: "clarification";
      sessionId: string;
      assistantMessage: string;
      message: string;
      criteria: UserCriteria;
      missingCriteria: MissingCriteria[];
      recommendations: [];
      ragCitations: RagEvidence[];
      rejectedSummary: RejectedSummary[];
    }
  | {
      type: "matches";
      sessionId: string;
      assistantMessage: string;
      message: string;
      criteria: UserCriteria;
      missingCriteria: MissingCriteria[];
      recommendations: MatchResult[];
      ragCitations: RagEvidence[];
      rejectedSummary: RejectedSummary[];
    }
  | {
      type: "no_matches";
      sessionId: string;
      assistantMessage: string;
      message: string;
      criteria: UserCriteria;
      missingCriteria: MissingCriteria[];
      recommendations: [];
      ragCitations: RagEvidence[];
      rejectedSummary: RejectedSummary[];
    };

export type CompareVehicle = {
  vehicle: Vehicle;
  tco: TcoBreakdown;
};
