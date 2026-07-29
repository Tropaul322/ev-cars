import type { MatchDiagnostics } from "./match-diagnostics.ts";
import type { SearchCriteriaDebug } from "./search-criteria-debug.ts";

export type Language = "de" | "en";
export type VehicleCondition = "new" | "used";
export type ChargingAccess = "home" | "work" | "public" | "none" | "unknown";
export type TripNeed = "city" | "commute" | "road_trip" | "family" | "winter";
export type Importance = "low" | "medium" | "high";
export type OptimizationDirective =
  | "best_value"
  | "maximum_range"
  | "most_reliable"
  | "fastest_charging"
  | "lowest_running_cost"
  | "best_family_fit"
  | "performance";

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

export type PersonalWish = "status" | "freedom";

export type MissingCriteria =
  | "budget"
  | "use_case"
  | "charging_or_range"
  | "vehicle_preferences"
  | "personal_wish";
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
  /** Set during embedding search; cosine similarity to the query vector (0–1). */
  embeddingSimilarity?: number;
  /** Set during hybrid text search; ts_rank_cd score from the query. */
  textRank?: number;
  /** Set during hybrid retrieval; reciprocal-rank-fusion score combining text and vector ranks. */
  retrievalScore?: number;
  raw?: unknown;
};

export type BrandOrigin = Vehicle["brandOrigin"];

export type UserCriteria = {
  language: Language;
  budgetMinEUR: number | null;
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
  optimizationDirective: OptimizationDirective | null;
  /** Emotional driver: status or freedom. */
  personalWish: PersonalWish | null;
  /**
   * Structured binding flags from clarification chips / explicit LLM patches.
   * When true, the matching field is a hard filter even without "only/must" wording.
   */
  bindingConstraints: {
    bodyTypes: boolean;
    rangeFloor: boolean;
  };
  location: string | null;
  rawPrompt: string;
  /** Latest user turn only — used for exclusive-language hard-constraint detection. */
  latestUserMessage: string;
};

export type CriteriaPatch = Partial<
  Omit<UserCriteria, "language" | "rawPrompt"> & {
    language: UserCriteria["language"];
    remove: string[];
  }
>;

export type ClarificationPromptKey = MissingCriteria | "ready" | "optimization";

export type ClarificationOption = {
  id: string;
  label: string;
  patch?: CriteriaPatch;
  skip?: boolean;
};

export type ClarificationPrompt = {
  key: ClarificationPromptKey;
  question: string;
  explanation: string;
  selectMode: "single" | "multi";
  options: ClarificationOption[];
  showMatchAction: boolean;
};

export type ScoringBreakdown = {
  priceFit: number;
  rangeFit: number;
  efficiencyFit: number;
  brandFit: number;
  cargoPassengerFit: number;
  reliabilityFit: number;
  featureFit: number;
};

export type RecommendationReason = {
  field: keyof Vehicle;
  label: string;
  value: string | number | boolean;
};

export type RecommendationReasonLedger = {
  positiveReasons: RecommendationReason[];
  tradeoffs: string[];
  passedHardFilters: string[];
  factorContributions: Partial<ScoringBreakdown>;
  evidenceIds: string[];
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

export type MatchScoreSource = "rules" | "llm";

export type SemanticBoostComponent = {
  key: "embedding" | "keyword" | "topic";
  label: string;
  detail: string;
  /** 0–1 strength of this signal before blending. */
  signal: number;
  /** Points this signal contributed to the displayed match boost. */
  points: number;
};

export type SemanticBoostBreakdown = {
  /** Total points added on top of the weighted rule score (after clamping). */
  totalPoints: number;
  /** Combined wording-fit strength 0–1 before scaling into points. */
  blendStrength: number;
  /** Max points the blend can add (14, 18, or 20 depending on available signals). */
  boostScale: number;
  components: SemanticBoostComponent[];
};

export type MatchResult = {
  vehicle: Vehicle;
  score: number;
  ruleScore?: number;
  llmScore?: number;
  scoreSource?: MatchScoreSource;
  llmFitSummary?: string;
  /** How semantic relevance raised score above the weighted rule average. */
  semanticBoost?: SemanticBoostBreakdown;
  ragScore: number;
  ragEvidence: RagEvidence[];
  hardFilterStatus: "passed";
  scoringBreakdown: ScoringBreakdown;
  /** Normalized weights used for the weighted match % (sum ≈ 1). */
  scoringWeights?: ScoringBreakdown;
  reasonLedger: RecommendationReasonLedger;
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
      prompt?: ClarificationPrompt;
      searchCriteriaDebug?: SearchCriteriaDebug;
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
      prompt?: ClarificationPrompt;
      searchCriteriaDebug?: SearchCriteriaDebug;
    }
  | {
      type: "matches";
      sessionId: string;
      assistantMessage: string;
      message: string;
      criteria: UserCriteria;
      missingCriteria: MissingCriteria[];
      recommendations: MatchResult[];
      alternativeRecommendations?: MatchResult[];
      alternativesAvailable: boolean;
      responseMode: "primary" | "alternatives";
      ragCitations: RagEvidence[];
      rejectedSummary: RejectedSummary[];
      matchDiagnostics?: MatchDiagnostics;
      searchCriteriaDebug?: SearchCriteriaDebug;
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
      matchDiagnostics?: MatchDiagnostics;
      searchCriteriaDebug?: SearchCriteriaDebug;
    };
export type { MatchDiagnostics, SearchCriteriaDebug };

export type CompareVehicle = {
  vehicle: Vehicle;
  tco: TcoBreakdown;
};
