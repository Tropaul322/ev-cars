"use client";

import { ArrowRight, Bookmark, ChevronDown, Loader2, Mic, Send, Sparkles, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { FlowRydShell } from "@/components/flowryd-demo-shell";
import { formatEUR, formatNumber } from "@/lib/utils";
import type { MatchResponse, MatchResult, UserCriteria } from "@/lib/types";

type Message =
  | { role: "user"; text: string }
  | { role: "bot"; text: ReactNode }
  | { role: "results"; matches: MatchResult[] };

const initialMessages: Message[] = [
  {
    role: "bot",
    text: (
      <>
        <p className="flow-message-title">Welcome back Eva!</p>
        <p>Tell me what kind of electric car you need.</p>
        <p>I&apos;ll ask for missing details before ranking real matches.</p>
      </>
    )
  }
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [criteria, setCriteria] = useState<UserCriteria | null>(null);
  const chatLogRef = useRef<HTMLDivElement>(null);
  const ranInitial = useRef(false);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      setMessages((current) => [...current, { role: "user", text: trimmed }]);
      setInput("");
      setLoading(true);

      try {
        const response = await fetch("/api/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            sessionId,
            previousCriteria: criteria
          })
        });

        if (!response.ok) throw new Error("The matching service returned an error.");

        const data = (await response.json()) as MatchResponse;
        setSessionId(data.sessionId);
        setCriteria(data.criteria);
        setMessages((current) => [
          ...current,
          { role: "bot", text: <p>{data.assistantMessage}</p> },
          ...(data.type === "matches" && data.recommendations.length
            ? [{ role: "results" as const, matches: data.recommendations }]
            : [])
        ]);
      } catch (error) {
        setMessages((current) => [
          ...current,
          {
            role: "bot",
            text: <p>{error instanceof Error ? error.message : "Something went wrong."}</p>
          }
        ]);
      } finally {
        setLoading(false);
      }
    },
    [criteria, loading, sessionId]
  );

  useEffect(() => {
    if (ranInitial.current) return;
    ranInitial.current = true;
    const query = new URLSearchParams(window.location.search).get("q");
    if (query) {
      send(query);
    } else {
      setMessages(initialMessages);
    }
  }, [send]);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    chatLogRef.current?.scrollTo({
      top: chatLogRef.current.scrollHeight,
      behavior: reduceMotion ? "auto" : "smooth"
    });
  }, [messages, loading]);

  return (
    <FlowRydShell hideFooter fullHeight>
      <div className="flow-chat">
        <header className="flow-chat-header">
          <span className="feature-icon">
            <Sparkles size={22} aria-hidden="true" />
          </span>
          <div>
            <h1>Find my car</h1>
            <p>Chat with FlowRyd to narrow your match.</p>
          </div>
        </header>

        <div className="flow-chat-log" ref={chatLogRef}>
          {messages.map((message, index) => {
            const animationDelay = `${Math.min(index * 35, 220)}ms`;

            if (message.role === "user") {
              return (
                <div
                  className="flow-chat-item flow-message-row flow-message-row-user"
                  key={index}
                  style={{ animationDelay }}
                >
                  <div className="flow-message-user">{message.text}</div>
                </div>
              );
            }
            if (message.role === "bot") {
              return (
                <div className="flow-chat-item flow-message-bot" key={index} style={{ animationDelay }}>
                  {message.text}
                </div>
              );
            }
            return <ResultsBlock animationDelay={animationDelay} key={index} matches={message.matches} />;
          })}
          {loading ? <LoadingBlock /> : null}
        </div>

        <form
          className="flow-composer"
          onSubmit={(event) => {
            event.preventDefault();
            send(input);
          }}
        >
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask a follow-up question..."
            aria-label="Ask a follow-up question"
          />
          <div className="flow-composer-actions">
            <button type="button" aria-label="Voice">
              <Mic size={16} aria-hidden="true" />
            </button>
            <button type="submit" aria-label="Send" disabled={!input.trim() || loading}>
              <Send size={16} aria-hidden="true" />
            </button>
          </div>
        </form>
      </div>
    </FlowRydShell>
  );
}

function ResultsBlock({ animationDelay, matches }: { animationDelay: string; matches: MatchResult[] }) {
  const [detailMatch, setDetailMatch] = useState<MatchResult | null>(null);
  const groups = groupMatchesByModel(matches);

  useEffect(() => {
    if (!detailMatch) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetailMatch(null);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailMatch]);

  return (
    <>
      <div className="flow-results">
        <div className="flow-results-count">
          {groups.length} model{groups.length === 1 ? "" : "s"} • {matches.length} listing
          {matches.length === 1 ? "" : "s"} found
        </div>
        {groups.map((group, index) => (
          <ModelCard
            animationDelay={index === 0 ? animationDelay : `${Math.min(index * 45, 240)}ms`}
            group={group}
            key={group.key}
            onOpenDetails={setDetailMatch}
          />
        ))}
      </div>
      <DetailsDrawer match={detailMatch} onClose={() => setDetailMatch(null)} />
    </>
  );
}

type MatchGroup = {
  key: string;
  title: string;
  matches: MatchResult[];
};

function ModelCard({
  animationDelay,
  group,
  onOpenDetails
}: {
  animationDelay: string;
  group: MatchGroup;
  onOpenDetails: (match: MatchResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const match = group.matches[0];
  const vehicle = match.vehicle;
  const imageSrc = vehicle.images[0] ?? "/flowryd/car-tesla-y.jpg";
  const isRemoteImage = imageSrc.startsWith("http://") || imageSrc.startsWith("https://");
  const rangeLabel = group.matches.length > 1 ? maxRangeLabel(group.matches) : formatRange(vehicle.rangeKm);

  return (
    <article className="flow-model-card flow-chat-item" style={{ animationDelay }}>
      <div className="flow-model-summary">
        <div className="flow-model-thumb">
          <Image src={imageSrc} alt={group.title} width={220} height={220} unoptimized={isRemoteImage} />
          <span>{match.score}%</span>
        </div>
        <div className="flow-model-copy">
          <h2>{group.title}</h2>
          <p>
            EV • Range: {rangeLabel}
          </p>
          <strong>{formatPriceRange(group.matches)}</strong>
        </div>
        <button
          className="flow-model-toggle"
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          {open ? "Hide" : `See ${group.matches.length} listing${group.matches.length === 1 ? "" : "s"}`}
          <ChevronDown className="flow-toggle-icon" size={18} aria-hidden="true" />
        </button>
      </div>
      {open ? <MatchListings matches={group.matches} onOpenDetails={onOpenDetails} /> : null}
    </article>
  );
}

function MatchListings({
  matches,
  onOpenDetails
}: {
  matches: MatchResult[];
  onOpenDetails: (match: MatchResult) => void;
}) {
  return (
    <div className="flow-listings">
      {matches.map((match, index) => (
        <ListingCard
          animationDelay={`${Math.min(index * 45, 220)}ms`}
          match={match}
          key={match.vehicle.id}
          onOpenDetails={onOpenDetails}
        />
      ))}
    </div>
  );
}

function ListingCard({
  animationDelay,
  match,
  onOpenDetails
}: {
  animationDelay: string;
  match: MatchResult;
  onOpenDetails: (match: MatchResult) => void;
}) {
  const vehicle = match.vehicle;
  const vehicleTitle = `${vehicle.make} ${vehicle.model}`;
  const imageSrc = vehicle.images[0] ?? "/flowryd/car-tesla-y.jpg";
  const isRemoteImage = imageSrc.startsWith("http://") || imageSrc.startsWith("https://");

  return (
    <article className="flow-listing-card flow-chat-item" style={{ animationDelay }}>
      <div className="flow-listing-media">
        <Image src={imageSrc} alt={vehicleTitle} width={520} height={360} unoptimized={isRemoteImage} />
        <span className="flow-listing-match">{match.score}% match</span>
        <button className="flow-listing-save" type="button" aria-label={`Save ${vehicleTitle}`}>
          <Bookmark size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="flow-listing-body">
        <h3>{vehicleTitle}</h3>
        <div className="flow-chip-row" aria-label={`${vehicleTitle} attributes`}>
          <span>{formatCondition(vehicle.condition)}</span>
          <span>{vehicle.year}</span>
          <span>EV</span>
          <span>Range: {formatRange(vehicle.rangeKm)}</span>
        </div>
        <p>{match.explanation}</p>
        <div className="flow-listing-actions">
          <strong>{formatEUR(match.tco.purchasePriceWithVAT)}</strong>
          <div>
            <button className="flow-listing-details" type="button" onClick={() => onOpenDetails(match)}>
              Details
            </button>
            <Link className="flow-listing-buy" href={vehicle.listingUrl ?? `/car/${vehicle.id}`}>
              Buy <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}

function DetailsDrawer({
  match,
  onClose
}: {
  match: MatchResult | null;
  onClose: () => void;
}) {
  if (!match) return null;

  const vehicle = match.vehicle;
  const vehicleTitle = `${vehicle.make} ${vehicle.model}`;
  const imageSrc = vehicle.images[0] ?? "/flowryd/car-tesla-y.jpg";
  const isRemoteImage = imageSrc.startsWith("http://") || imageSrc.startsWith("https://");
  const specs = getDrawerSpecs(match);

  return (
    <div className="flow-detail-drawer" role="dialog" aria-modal="true" aria-label={`${vehicleTitle} details`}>
      <button className="flow-detail-backdrop" type="button" aria-label="Close details" onClick={onClose} />
      <aside className="flow-detail-panel">
        <button className="flow-detail-close" type="button" aria-label="Close details" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>

        <header className="flow-detail-drawer-header">
          <div className="flow-detail-drawer-thumb">
            <Image src={imageSrc} alt={vehicleTitle} width={112} height={112} unoptimized={isRemoteImage} />
            <span>{match.score}%</span>
          </div>
          <div>
            <h2>{vehicleTitle}</h2>
            <strong>{formatEUR(match.tco.purchasePriceWithVAT)}</strong>
          </div>
        </header>

        <div className="flow-chip-row flow-drawer-chip-row" aria-label={`${vehicleTitle} attributes`}>
          <span>{formatCondition(vehicle.condition)}</span>
          <span>{vehicle.year}</span>
          <span>EV</span>
          <span>Range: {formatRange(vehicle.rangeKm)}</span>
        </div>

        <section className="flow-drawer-stat-grid" aria-label="Vehicle quick stats">
          <DrawerStat label="Price" value={formatEUR(match.tco.purchasePriceWithVAT)} />
          <DrawerStat label="Range" value={formatRange(vehicle.rangeKm)} />
          <DrawerStat label="Cargo" value={`${formatNumber(vehicle.cargoLiters)} L`} />
          <DrawerStat label="Efficiency" value={`${vehicle.efficiencyKwhPer100Km} kWh/100 km`} />
          <DrawerStat label="Battery" value={`${vehicle.batteryKwh} kWh`} />
          <DrawerStat label="SoH" value={vehicle.batterySoH === null ? "Not provided" : `${vehicle.batterySoH}%`} />
        </section>

        <section className="flow-drawer-section" aria-labelledby="score-breakdown-heading">
          <h3 id="score-breakdown-heading">Score breakdown</h3>
          <div className="flow-drawer-score-list">
            {formatScoringBreakdown(match).map(({ label, value }) => (
              <div className="flow-drawer-score-row" key={label}>
                <span>{label}</span>
                <div>
                  <span style={{ width: `${value}%` }} />
                </div>
                <strong>{value}%</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="flow-drawer-section" aria-labelledby="specs-heading">
          <h3 id="specs-heading">Specs</h3>
          <dl className="flow-drawer-specs">
            {specs.map(({ label, value }) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </aside>
    </div>
  );
}

function DrawerStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flow-drawer-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function groupMatchesByModel(matches: MatchResult[]): MatchGroup[] {
  const groups = new Map<string, MatchGroup>();

  for (const match of matches) {
    const key = `${match.vehicle.make.trim().toLowerCase()}-${match.vehicle.model.trim().toLowerCase()}`;
    const title = `${match.vehicle.make} ${match.vehicle.model}`;
    const group = groups.get(key);

    if (group) {
      group.matches.push(match);
    } else {
      groups.set(key, { key, title, matches: [match] });
    }
  }

  return [...groups.values()];
}

function formatPriceRange(matches: MatchResult[]) {
  const prices = matches.map((match) => match.tco.purchasePriceWithVAT);
  const min = Math.min(...prices);
  const max = Math.max(...prices);

  return min === max ? formatEUR(min) : `${formatEUR(min)} - ${formatEUR(max)}`;
}

function formatScoringBreakdown(match: MatchResult) {
  return [
    { label: "Price", value: match.scoringBreakdown.priceFit },
    { label: "Range", value: match.scoringBreakdown.rangeFit },
    { label: "Efficiency", value: match.scoringBreakdown.efficiencyFit },
    { label: "TCO", value: match.scoringBreakdown.tcoFit },
    { label: "Brand", value: match.scoringBreakdown.brandFit },
    { label: "Cargo / seats", value: match.scoringBreakdown.cargoPassengerFit },
    { label: "Reliability", value: match.scoringBreakdown.reliabilityFit },
    { label: "Features", value: match.scoringBreakdown.featureFit },
    { label: "Persona", value: match.scoringBreakdown.personaFit },
    { label: "Battery health", value: match.scoringBreakdown.batteryHealthFit },
    { label: "Semantic", value: match.scoringBreakdown.semanticFit }
  ];
}

function getDrawerSpecs(match: MatchResult) {
  const vehicle = match.vehicle;
  return [
    { label: "Variant", value: [vehicle.trim, vehicle.drivetrain, formatBodyType(vehicle.bodyType)].filter(Boolean).join(", ") },
    { label: "Exterior", value: vehicle.exteriorColor ?? "Not provided" },
    { label: "Interior", value: `${vehicle.seats} seats; interior color not provided` },
    { label: "Driver assist", value: formatDriverAssist(vehicle.features) },
    { label: "Location", value: vehicle.location ?? "Not provided" },
    {
      label: "Mileage",
      value: vehicle.mileageKm === null ? "Not provided" : `${formatNumber(vehicle.mileageKm)} km`
    }
  ];
}

function formatDriverAssist(features: MatchResult["vehicle"]["features"]) {
  const driverAssistLabels: Partial<Record<MatchResult["vehicle"]["features"][number], string>> = {
    adaptive_cruise_control: "Adaptive cruise control",
    lane_keeping_assist: "Lane keeping assist",
    blind_spot_detection: "Blind spot detection"
  };
  const labels = features
    .map((feature) => driverAssistLabels[feature])
    .filter((label): label is string => Boolean(label));

  return labels.length ? labels.join(", ") : "Not provided";
}

function formatBodyType(bodyType: MatchResult["vehicle"]["bodyType"]) {
  return bodyType.replace(/_/g, " ");
}

function maxRangeLabel(matches: MatchResult[]) {
  return formatRange(Math.max(...matches.map((match) => match.vehicle.rangeKm)));
}

function formatRange(rangeKm: number) {
  return `${formatNumber(rangeKm)} km`;
}

function formatCondition(condition: MatchResult["vehicle"]["condition"]) {
  return condition === "new" ? "New" : "Used";
}

function LoadingBlock() {
  return (
    <div className="flow-loading flow-chat-item">
      <Loader2 className="spin-icon" size={24} aria-hidden="true" />
      <div>
        <strong>FlowRyd is thinking...</strong>
        <p>
          Matching against inventory
          <span className="flow-typing-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </p>
      </div>
    </div>
  );
}
