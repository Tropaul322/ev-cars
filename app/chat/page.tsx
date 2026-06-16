"use client";

import {
  ArrowRight,
  ChevronDown,
  Loader2,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FlowRydShell } from "@/components/flowryd-demo-shell";
import { SaveCarButton } from "@/components/save-car-button";
import { Drawer, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useAnimatedDrawer } from "@/components/ui/use-animated-drawer";
import {
  openDemoRegistration,
  requireDemoAccess,
} from "@/lib/demo-access-client";
import type { SavedCarSnapshot } from "@/lib/repositories/saved-car-repository";
import { formatEUR, formatNumber } from "@/lib/utils";
import type { MatchResponse, MatchResult, UserCriteria } from "@/lib/types";
import {
  formatCondition,
  getVehicleDetailSections,
  getVehicleDetailStats,
  vehicleDetailSectionId,
} from "@/lib/vehicle-detail-fields";

type Message =
  | { role: "user"; text: string }
  | { role: "bot"; text: ReactNode }
  | { role: "results"; matches: MatchResult[] };

const initialMessages: Message[] = [
  {
    role: "bot",
    text: (
      <>
        <p>
          Hey! I&apos;m FlowRyd, your electric car assistant. Tell me what kind of
          electric car you need.
        </p>
        <p>I&apos;ll ask for missing details before ranking real matches.</p>
      </>
    ),
  },
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [criteria, setCriteria] = useState<UserCriteria | null>(null);
  const chatLogRef = useRef<HTMLDivElement>(null);
  const ranInitial = useRef(false);

  const send = useCallback(
    async (
      text: string,
      options: { preserveInputOnBlocked?: boolean } = {},
    ) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      const allowed = await requireDemoAccess();
      if (!allowed) {
        if (options.preserveInputOnBlocked) setInput(trimmed);
        return;
      }

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
            previousCriteria: criteria,
          }),
        });

        if (response.status === 401) {
          openDemoRegistration();
          throw new Error("Demo registration is required.");
        }
        if (!response.ok)
          throw new Error("The matching service returned an error.");

        const data = (await response.json()) as MatchResponse;
        setSessionId(data.sessionId);
        setCriteria(data.criteria);
        setMessages((current) => [
          ...current,
          { role: "bot", text: <p>{data.assistantMessage}</p> },
          ...(data.type === "matches" && data.recommendations.length
            ? [{ role: "results" as const, matches: data.recommendations }]
            : []),
        ]);
      } catch (error) {
        setMessages((current) => [
          ...current,
          {
            role: "bot",
            text: (
              <p>
                {error instanceof Error
                  ? error.message
                  : "Something went wrong."}
              </p>
            ),
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [criteria, loading, sessionId],
  );

  useEffect(() => {
    if (ranInitial.current) return;
    ranInitial.current = true;
    const query = new URLSearchParams(window.location.search).get("q");
    if (query) {
      send(query, { preserveInputOnBlocked: true });
    }
  }, [send]);

  useEffect(() => {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: reduceMotion ? "auto" : "smooth",
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
                <div
                  className="flow-chat-item flow-message-bot"
                  key={index}
                  style={{ animationDelay }}
                >
                  {message.text}
                </div>
              );
            }
            return (
              <ResultsBlock
                animationDelay={animationDelay}
                key={index}
                matches={message.matches}
              />
            );
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
            <button
              type="submit"
              aria-label="Send"
              disabled={!input.trim() || loading}
            >
              <Send size={16} aria-hidden="true" />
            </button>
          </div>
        </form>
      </div>
    </FlowRydShell>
  );
}

function ResultsBlock({
  animationDelay,
  matches,
}: {
  animationDelay: string;
  matches: MatchResult[];
}) {
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
          {groups.length} model{groups.length === 1 ? "" : "s"} •{" "}
          {matches.length} listing
          {matches.length === 1 ? "" : "s"} found
        </div>
        {groups.map((group, index) => (
          <ModelCard
            animationDelay={
              index === 0 ? animationDelay : `${Math.min(index * 45, 240)}ms`
            }
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
  onOpenDetails,
}: {
  animationDelay: string;
  group: MatchGroup;
  onOpenDetails: (match: MatchResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const match = group.matches[0];
  const vehicle = match.vehicle;
  const imageSrc = vehicle.images[0] ?? "/flowryd/car-tesla-y.jpg";
  const isRemoteImage =
    imageSrc.startsWith("http://") || imageSrc.startsWith("https://");
  const rangeLabel =
    group.matches.length > 1
      ? maxRangeLabel(group.matches)
      : formatRange(vehicle.rangeKm);

  return (
    <article
      className="flow-model-card flow-chat-item"
      style={{ animationDelay }}
    >
      <div className="flow-model-summary">
        <div className="flow-model-thumb">
          <Image
            src={imageSrc}
            alt={group.title}
            width={220}
            height={220}
            unoptimized={isRemoteImage}
          />
          <span>{match.score}%</span>
        </div>
        <div className="flow-model-copy">
          <h2>{group.title}</h2>
          <p>EV • Range: {rangeLabel}</p>
          <strong>{formatPriceRange(group.matches)}</strong>
        </div>
        <button
          className="flow-model-toggle"
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          {open
            ? "Hide"
            : `See ${group.matches.length} listing${group.matches.length === 1 ? "" : "s"}`}
          <ChevronDown
            className="flow-toggle-icon"
            size={18}
            aria-hidden="true"
          />
        </button>
      </div>
      {open ? (
        <MatchListings matches={group.matches} onOpenDetails={onOpenDetails} />
      ) : null}
    </article>
  );
}

function MatchListings({
  matches,
  onOpenDetails,
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
  onOpenDetails,
}: {
  animationDelay: string;
  match: MatchResult;
  onOpenDetails: (match: MatchResult) => void;
}) {
  const vehicle = match.vehicle;
  const vehicleTitle = `${vehicle.make} ${vehicle.model}`;
  const imageSrc = vehicle.images[0] ?? "/flowryd/car-tesla-y.jpg";
  const isRemoteImage =
    imageSrc.startsWith("http://") || imageSrc.startsWith("https://");
  const listingHref = vehicle.listingUrl ?? `/car/${vehicle.id}`;

  return (
    <article
      className="flow-listing-card flow-chat-item"
      style={{ animationDelay }}
    >
      <div className="flow-listing-media">
        <Image
          src={imageSrc}
          alt={vehicleTitle}
          width={520}
          height={360}
          unoptimized={isRemoteImage}
        />
        <span className="flow-listing-match">{match.score}% match</span>
        <SaveCarButton
          vehicleId={vehicle.id}
          snapshot={snapshotFromMatch(match)}
          className="flow-listing-save"
          activeClassName="flow-listing-save-active"
        />
      </div>
      <div className="flow-listing-body">
        <h3>{vehicleTitle}</h3>
        <div
          className="flow-chip-row"
          aria-label={`${vehicleTitle} attributes`}
        >
          <span>{formatCondition(vehicle.condition)}</span>
          <span>{vehicle.year}</span>
          <span>EV</span>
          <span>Range: {formatRange(vehicle.rangeKm)}</span>
        </div>
        <p>{match.explanation}</p>
        <div className="flow-listing-actions">
          <strong>{formatEUR(match.tco.purchasePriceWithVAT)}</strong>
          <div>
            <button
              className="flow-listing-details"
              type="button"
              onClick={() => onOpenDetails(match)}
            >
              Details
            </button>
            <Link
              className="flow-listing-buy"
              href={listingHref}
              onClick={async (event) => {
                event.preventDefault();
                if (await requireDemoAccess())
                  window.location.assign(listingHref);
              }}
            >
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
  onClose,
}: {
  match: MatchResult | null;
  onClose: () => void;
}) {
  const { open, onOpenChange } = useAnimatedDrawer(Boolean(match), onClose);

  if (!match) return null;

  const vehicle = match.vehicle;
  const vehicleTitle = `${vehicle.make} ${vehicle.model}`;
  const imageSrc = vehicle.images[0] ?? "/flowryd/car-tesla-y.jpg";
  const isRemoteImage =
    imageSrc.startsWith("http://") || imageSrc.startsWith("https://");
  const stats = getVehicleDetailStats(
    vehicle,
    formatEUR(match.tco.purchasePriceWithVAT),
  );
  const detailSections = getVehicleDetailSections(vehicle);

  return (
    <Drawer
      open={open}
      direction="right"
      shouldScaleBackground={false}
      onOpenChange={onOpenChange}
    >
      <DrawerContent className="flow-detail-panel">
        <DrawerClose className="flow-detail-close" aria-label="Close details">
          <X size={18} aria-hidden="true" />
        </DrawerClose>

        <div className="flow-detail-panel-body">
          <DrawerHeader className="flow-detail-drawer-header">
            <div className="flow-detail-drawer-thumb">
              <Image
                src={imageSrc}
                alt={vehicleTitle}
                width={112}
                height={112}
                unoptimized={isRemoteImage}
              />
              <span>{match.score}%</span>
            </div>
            <div>
              <DrawerTitle className="flow-detail-drawer-title">{vehicleTitle}</DrawerTitle>
              <p className="flow-detail-drawer-price">
                {formatEUR(match.tco.purchasePriceWithVAT)}
              </p>
            </div>
          </DrawerHeader>

          <div
            className="flow-chip-row flow-drawer-chip-row"
            aria-label={`${vehicleTitle} attributes`}
          >
            <span>{formatCondition(vehicle.condition)}</span>
            <span>{vehicle.year}</span>
            <span>EV</span>
            <span>Range: {formatRange(vehicle.rangeKm)}</span>
          </div>

          <section
            className="flow-drawer-stat-grid"
            aria-label="Vehicle quick stats"
          >
            {stats.map(({ label, value }) => (
              <DrawerStat label={label} value={value} key={label} />
            ))}
          </section>

          <section
            className="flow-drawer-section"
            aria-labelledby="score-breakdown-heading"
          >
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

          {detailSections.map((section) => {
            const headingId = vehicleDetailSectionId("drawer", section.heading);
            return (
              <section
                className="flow-drawer-section"
                aria-labelledby={headingId}
                key={section.heading}
              >
                <h3 id={headingId}>{section.heading}</h3>
                <dl className="flow-drawer-specs">
                  {section.items.map(({ label, value }) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })}

          <Link
            className="flow-drawer-primary-link"
            href={vehicle.listingUrl ?? `/car/${vehicle.id}`}
            target={vehicle.listingUrl ? "_blank" : undefined}
            rel={vehicle.listingUrl ? "noreferrer" : undefined}
          >
            {vehicle.listingUrl ? "Open listing" : "Open car page"}
          </Link>
        </div>
      </DrawerContent>
    </Drawer>
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

  return [...groups.values()]
    .map((group) => ({
      ...group,
      matches: [...group.matches].sort(
        (left, right) =>
          right.score - left.score || right.ragScore - left.ragScore,
      ),
    }))
    .sort(
      (left, right) =>
        (right.matches[0]?.score ?? 0) - (left.matches[0]?.score ?? 0) ||
        (right.matches[0]?.ragScore ?? 0) - (left.matches[0]?.ragScore ?? 0),
    );
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
    { label: "Semantic", value: match.scoringBreakdown.semanticFit },
  ];
}

function maxRangeLabel(matches: MatchResult[]) {
  return formatRange(
    Math.max(...matches.map((match) => match.vehicle.rangeKm)),
  );
}

function snapshotFromMatch(match: MatchResult): SavedCarSnapshot {
  const vehicle = match.vehicle;
  return {
    id: vehicle.id,
    name: `${vehicle.make} ${vehicle.model}`,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    price: formatEUR(match.tco.purchasePriceWithVAT),
    condition: formatCondition(vehicle.condition),
    location: vehicle.location ?? null,
    image: vehicle.images[0] ?? null,
    match: match.score,
    range: formatRange(vehicle.rangeKm),
    mileage:
      vehicle.mileageKm === null
        ? null
        : `${formatNumber(vehicle.mileageKm)} km`,
  };
}

function formatRange(rangeKm: number) {
  return `${formatNumber(rangeKm)} km`;
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
