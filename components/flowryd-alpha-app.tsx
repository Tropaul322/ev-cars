"use client";

import {
  BatteryCharging,
  Check,
  ChevronLeft,
  ChevronRight,
  Info,
  Loader2,
  Search,
  Send,
  ShoppingBag,
  Sparkles,
  X
} from "lucide-react";
import Image from "next/image";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { criteriaChips, removeCriteriaKey, type CriteriaChip } from "@/lib/criteria";
import { cn, formatEUR, formatNumber } from "@/lib/utils";
import type { MatchResponse, MatchResult, RagEvidence, RejectedSummary, ScoringBreakdown, UserCriteria } from "@/lib/types";

type ChatMessage = {
  id: string;
  role: "user" | "agent";
  content: string;
  recommendations?: MatchResult[];
  rejectedSummary?: RejectedSummary[];
  ragCitations?: RagEvidence[];
};

const starterPrompts = [
  "Ich wohne in Wien ohne Wallbox, Budget 40k, brauche 400 km Reichweite und gute Assistenzsysteme.",
  "Used EV under 35k for city commuting, CarPlay, heated seats, and low running costs.",
  "Familien-SUV bis 50.000 EUR, großer Kofferraum, Autobahn und Winterfahrten.",
  "New Chinese EV around 45k with strong tech, blind spot detection, and long range."
];

export function FlowRydAlphaApp() {
  const [input, setInput] = React.useState("");
  const [messages, setMessages] = React.useState<ChatMessage[]>([
    {
      id: "intro",
      role: "agent",
      content:
        "Hey, how can I help you today? Tell me what kind of electric car you need; I will ask for missing details before ranking."
    }
  ]);
  const [criteria, setCriteria] = React.useState<UserCriteria | null>(null);
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submitPrompt = React.useCallback(
    async (
      prompt: string,
      options: { criteriaOverride?: UserCriteria; displayPrompt?: string } = {}
    ) => {
      const trimmed = prompt.trim();
      if (!trimmed || loading) return;

      setLoading(true);
      setError(null);
      setInput("");
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "user", content: options.displayPrompt ?? trimmed }
      ]);

      try {
        const response = await fetch("/api/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            sessionId,
            previousCriteria: options.criteriaOverride ?? criteria,
            criteriaOverride: options.criteriaOverride
          })
        });
        if (!response.ok) throw new Error("The matching service returned an error.");

        const data = (await response.json()) as MatchResponse;
        setSessionId(data.sessionId);
        setCriteria(data.criteria);
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "agent",
            content: data.assistantMessage,
            recommendations: data.type === "matches" ? data.recommendations : undefined,
            rejectedSummary: data.rejectedSummary.length ? data.rejectedSummary : undefined,
            ragCitations: data.ragCitations.length ? data.ragCitations : undefined
          }
        ]);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Something went wrong.");
      } finally {
        setLoading(false);
      }
    },
    [criteria, loading, sessionId]
  );

  const chips = criteria ? criteriaChips(criteria) : [];

  const removeCriterion = (chip: CriteriaChip) => {
    if (!criteria) return;
    const nextCriteria = removeCriteriaKey(criteria, chip.key);
    setCriteria(nextCriteria);
    submitPrompt(`Removed ${chip.label}.`, {
      criteriaOverride: nextCriteria,
      displayPrompt: `Remove ${chip.label}`
    });
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark">
          <div className="brand-icon">FR</div>
          <div>
            <h1 className="brand-title">FlowRyd Alpha</h1>
            <p className="brand-subtitle">Austria EV matching prototype</p>
          </div>
        </div>
        <div className="status-row" aria-label="Alpha status">
          <span className="status-pill">
            <Check size={14} aria-hidden="true" /> Seed inventory
          </span>
          <span className="status-pill">
            <Sparkles size={14} aria-hidden="true" /> Gemini + embeddings
          </span>
          <span className="status-pill">
            <BatteryCharging size={14} aria-hidden="true" /> BEV only
          </span>
        </div>
      </header>

      <section className="workspace">
        <section className="surface chat-panel" aria-label="EV discovery chat">
          <div className="panel-header">
            <div className="panel-title-row">
              <h2 className="panel-title">
                <Search size={18} aria-hidden="true" /> Discovery
              </h2>
              {loading ? (
                <span className="status-pill loading">
                  <Loader2 size={14} aria-hidden="true" /> Matching
                </span>
              ) : null}
            </div>
            <p className="panel-note">
              The agent chats first, collects enough criteria, then turns hard filters and weighted
              preferences into explainable recommendations.
            </p>
          </div>

          {chips.length ? (
            <div className="criteria-strip" aria-label="Current matching criteria">
              {chips.map((chip) => (
                <button
                  key={`${chip.key}-${chip.label}`}
                  className="criteria-chip"
                  type="button"
                  onClick={() => removeCriterion(chip)}
                  title={`Remove ${chip.label}`}
                  disabled={loading}
                >
                  <span>{chip.label}</span>
                  <X size={13} aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : null}

          <div className="chat-log" aria-busy={loading}>
            {messages.map((message) => (
              <div
                key={message.id}
                className={`message-group ${message.role === "user" ? "message-group-user" : "message-group-agent"}`}
              >
                <div
                  className={`message ${message.role === "user" ? "message-user" : "message-agent"}`}
                >
                  {message.content}
                </div>
                {message.rejectedSummary?.length ? (
                  <MatchInsights rejectedSummary={message.rejectedSummary} ragCitations={message.ragCitations} />
                ) : null}
                {message.recommendations?.length ? (
                  <VehicleShortlist matches={message.recommendations} />
                ) : null}
              </div>
            ))}
            {loading ? <MatchingState /> : null}
            {error ? <div className="message message-agent">{error}</div> : null}
          </div>

          <div className="starter-grid">
            {starterPrompts.map((prompt) => (
              <Button
                key={prompt}
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => submitPrompt(prompt)}
                disabled={loading}
              >
                <Sparkles size={14} aria-hidden="true" />
                {prompt}
              </Button>
            ))}
          </div>

          <form
            className="input-form"
            onSubmit={(event) => {
              event.preventDefault();
              submitPrompt(input);
            }}
          >
            <div className="input-row">
              <textarea
                className="composer-textarea"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submitPrompt(input);
                  }
                }}
                placeholder="z.B. SUV bis 45k, keine Wallbox, Familie, 450 km Reichweite"
                aria-label="Describe your EV needs"
                rows={3}
              />
              <Button type="submit" disabled={loading || !input.trim()} title="Find matches">
                {loading ? (
                  <Loader2 className="spin-icon" size={16} aria-hidden="true" />
                ) : (
                  <Send size={16} aria-hidden="true" />
                )}
                Send
              </Button>
            </div>
            <div className="input-hint">
              Alpha note: the agent looks for budget plus use case, charging/range, and one preference before matching.
            </div>
          </form>
        </section>
      </section>
    </main>
  );
}

function MatchingState() {
  return (
    <div className="message-group message-group-agent">
      <div className="message message-agent matching-state" role="status" aria-live="polite">
        <div className="matching-state-icon" aria-hidden="true">
          <Loader2 size={16} />
        </div>
        <div>
          <div className="matching-state-title">Matching against inventory</div>
          <div className="matching-state-copy">Checking hard filters, range, charging fit, and tradeoffs.</div>
        </div>
      </div>
    </div>
  );
}

function VehicleShortlist({ matches }: { matches: MatchResult[] }) {
  const [activeIndex, setActiveIndex] = React.useState(0);
  const activeMatch = matches[activeIndex] ?? matches[0];
  const hasMultipleMatches = matches.length > 1;

  const goToPrevious = () => {
    setActiveIndex((current) => (current === 0 ? matches.length - 1 : current - 1));
  };

  const goToNext = () => {
    setActiveIndex((current) => (current === matches.length - 1 ? 0 : current + 1));
  };

  React.useEffect(() => {
    setActiveIndex(0);
  }, [matches]);

  if (!activeMatch) return null;

  return (
    <section className="vehicle-shortlist" aria-label="Recommended vehicles">
      <div className="shortlist-header">
        <div>
          <div className="shortlist-eyebrow">Recommended shortlist</div>
          <h3 className="shortlist-title">
            {activeIndex === 0 ? "Best fit first" : `Option ${activeIndex + 1}`}
          </h3>
        </div>
        <div className="carousel-toolbar" aria-label="Recommendation carousel controls">
          <span className="shortlist-count">
            {activeIndex + 1} of {matches.length}
          </span>
          {hasMultipleMatches ? (
            <div className="carousel-arrows">
              <Button type="button" size="icon" variant="secondary" onClick={goToPrevious} title="Previous car">
                <ChevronLeft size={16} aria-hidden="true" />
              </Button>
              <Button type="button" size="icon" variant="secondary" onClick={goToNext} title="Next car">
                <ChevronRight size={16} aria-hidden="true" />
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <VehicleCard
        key={activeMatch.vehicle.id}
        match={activeMatch}
        rankLabel={activeIndex === 0 ? "Top pick" : `Option ${activeIndex + 1}`}
      />

      {hasMultipleMatches ? (
        <div className="carousel-selector" aria-label="Choose a recommended vehicle">
          {matches.map((match, index) => (
            <button
              key={match.vehicle.id}
              className={cn("carousel-option", index === activeIndex && "carousel-option-active")}
              type="button"
              onClick={() => setActiveIndex(index)}
              aria-current={index === activeIndex ? "true" : undefined}
            >
              <span className="carousel-dot" aria-hidden="true" />
              <span>
                {match.vehicle.make} {match.vehicle.model}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function VehicleCard({
  match,
  rankLabel
}: {
  match: MatchResult;
  rankLabel?: string;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const vehicle = match.vehicle;
  const imageSrc = vehicle.images[0];
  const isRemoteImage = imageSrc.startsWith("http://") || imageSrc.startsWith("https://");

  return (
    <article className={cn("vehicle-card", expanded && "vehicle-card-expanded")}>
      <div className="vehicle-media">
        <Image
          className="vehicle-image"
          src={imageSrc}
          alt={`${vehicle.make} ${vehicle.model}`}
          width={1200}
          height={675}
          sizes="(max-width: 720px) calc(100vw - 56px), 820px"
          unoptimized={isRemoteImage}
        />
      </div>
      <div className="vehicle-body">
        <div className="vehicle-heading">
          <div>
            {rankLabel ? <div className="vehicle-rank">{rankLabel}</div> : null}
            <h3 className="vehicle-title">
              {vehicle.make} {vehicle.model}
            </h3>
            <div className="vehicle-meta">
              {vehicle.year} · {vehicle.condition} · {vehicle.bodyType} · {vehicle.source}
            </div>
          </div>
          <span className="score-badge">{match.score}% Match</span>
        </div>

        <div className="metric-grid">
          <Metric label="Price" value={formatEUR(match.tco.purchasePriceWithVAT)} />
          <Metric label="Lease" value={vehicle.monthlyLeaseEUR ? formatEUR(vehicle.monthlyLeaseEUR) : "n/a"} />
          <Metric label="Range" value={`${formatNumber(vehicle.rangeKm)} km`} />
          <Metric label="Cargo" value={`${formatNumber(vehicle.cargoLiters)} L`} />
        </div>

        <p className="why-copy">{match.explanation}</p>

        {expanded ? (
          <>
            <div className="metric-grid">
              <Metric label="Efficiency" value={`${vehicle.efficiencyKwhPer100Km} kWh/100 km`} />
              <Metric label="Battery" value={`${vehicle.batteryKwh} kWh`} />
              <Metric
                label="SoH"
                value={vehicle.condition === "new" ? "new" : vehicle.batterySoH ? `${vehicle.batterySoH}%` : "not disclosed"}
              />
            </div>
            <div className="ruled-out">
              {match.ruledOutReasons.length
                ? match.ruledOutReasons.join("; ")
                : "No major tradeoff surfaced for the stated criteria."}
            </div>
            <div className="rag-context">
              <div className="rag-context-heading">Score breakdown</div>
              <div className="score-breakdown">
                {formatScoringBreakdown(match.scoringBreakdown).map((item) => (
                  <div key={item.label} className="score-breakdown-item">
                    <span>{item.label}</span>
                    <span>{item.value}%</span>
                  </div>
                ))}
              </div>
            </div>
            {match.ragEvidence.length ? (
              <div className="rag-context">
                <div className="rag-context-heading">Retrieved context</div>
                {match.ragEvidence.slice(0, 3).map((evidence) => (
                  <div key={`${evidence.sourceType}-${evidence.sourceId}`} className="rag-context-item">
                    <div className="rag-context-title">
                      {formatEvidenceSource(evidence.sourceType)} · {evidence.title} · {Math.round(evidence.score * 100)}%
                    </div>
                    <div className="rag-context-copy">{evidence.excerpt}</div>
                    {evidence.sourceUrl ? (
                      <a className="rag-context-link" href={evidence.sourceUrl} target="_blank" rel="noreferrer">
                        Source
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        <div className="card-actions">
          <Button type="button" size="sm" variant="secondary" onClick={() => setExpanded((value) => !value)}>
            <Info size={14} aria-hidden="true" />
            {expanded ? "Hide details" : "Show details"}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled title="Non-functional alpha CTA">
            <ShoppingBag size={14} aria-hidden="true" />
            Buy
          </Button>
        </div>
      </div>
    </article>
  );
}

function MatchInsights({
  rejectedSummary,
  ragCitations
}: {
  rejectedSummary: RejectedSummary[];
  ragCitations?: RagEvidence[];
}) {
  return (
    <div className="match-insights">
      <div className="match-insights-section">
        <div className="rag-context-heading">Ruled out</div>
        <ul className="match-insights-list">
          {rejectedSummary.map((item) => (
            <li key={item.reason}>
              {item.reason} ({item.count})
            </li>
          ))}
        </ul>
      </div>
      {ragCitations?.length ? (
        <div className="match-insights-section">
          <div className="rag-context-heading">Knowledge retrieved</div>
          {ragCitations.slice(0, 3).map((citation) => (
            <div key={`${citation.sourceType}-${citation.sourceId}`} className="rag-context-item">
              <div className="rag-context-title">
                {formatEvidenceSource(citation.sourceType)} · {citation.title} · {Math.round(citation.score * 100)}%
              </div>
              <div className="rag-context-copy">{citation.excerpt}</div>
              {citation.sourceUrl ? (
                <a className="rag-context-link" href={citation.sourceUrl} target="_blank" rel="noreferrer">
                  Source
                </a>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function formatScoringBreakdown(breakdown: ScoringBreakdown) {
  return [
    { label: "Price", value: breakdown.priceFit },
    { label: "Range", value: breakdown.rangeFit },
    { label: "Efficiency", value: breakdown.efficiencyFit },
    { label: "TCO", value: breakdown.tcoFit },
    { label: "Brand", value: breakdown.brandFit },
    { label: "Cargo / seats", value: breakdown.cargoPassengerFit },
    { label: "Reliability", value: breakdown.reliabilityFit },
    { label: "Features", value: breakdown.featureFit },
    { label: "Persona", value: breakdown.personaFit },
    { label: "Battery health", value: breakdown.batteryHealthFit },
    { label: "Semantic", value: breakdown.semanticFit }
  ];
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
    </div>
  );
}

function formatEvidenceSource(sourceType: MatchResult["ragEvidence"][number]["sourceType"]) {
  return sourceType === "vehicle_payload" ? "Vehicle data" : "Knowledge";
}
