import { ArrowLeft, Bookmark } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FlowRydShell } from "@/components/flowryd-demo-shell";
import { demoCars, demoQuickStats, demoScoreBreakdown } from "@/lib/flowryd-demo-data";

export function generateStaticParams() {
  return Object.keys(demoCars).map((id) => ({ id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const car = demoCars[id];
  return {
    title: car ? `${car.name} — FlowRyd` : "Car — FlowRyd",
    description: car ? `${car.name} — ${car.range} range, ${car.price}.` : undefined
  };
}

export default async function CarDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const car = demoCars[id];
  if (!car) notFound();
  const stats = demoQuickStats[car.id];
  const scores = demoScoreBreakdown[car.id] ?? [];

  return (
    <FlowRydShell>
      <div className="flow-detail-page">
        <Link className="flow-back-link" href="/chat">
          <ArrowLeft size={16} aria-hidden="true" /> Back to chat
        </Link>

        <div className="flow-detail-grid">
          <section>
            <div className="flow-detail-gallery">
              <Image src={car.image} alt={car.name} width={980} height={735} priority />
              <div className="flow-gallery-dots" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </div>
            </div>

            <section className="flow-detail-block">
              <h2>Details</h2>
              <div className="flow-stat-grid">
                <Stat label="Price" value={car.price} />
                <Stat label="Range" value={car.range} />
                <Stat label="Cargo" value={stats.cargo} />
                <Stat label="Efficiency" value={stats.efficiency} />
                <Stat label="Battery" value={stats.battery} />
                <Stat label="SoH" value={car.condition === "New" ? "new" : stats.soh} />
              </div>
            </section>

            <section className="flow-detail-block">
              <h2>Score breakdown</h2>
              <div className="flow-score-list">
                {scores.map(([label, value]) => (
                  <div className="flow-score-row" key={label}>
                    <span>{label}</span>
                    <div>
                      <span style={{ width: `${value}%` }} />
                    </div>
                    <strong>{value}%</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="flow-detail-block">
              <h2>Reviews</h2>
              <div className="flow-review-grid">
                <Review name="Jose" when="10h" text="After 6 months daily: smooth drive, great efficiency, software keeps improving." />
                <Review name="Mia" when="2d" text="Range matches the advertised spec on the highway. Charging network is unbeatable for road trips." />
              </div>
            </section>
          </section>

          <aside className="flow-buy-panel">
            <span className="trending-match">{car.match}% match</span>
            <h1>{car.name}</h1>
            <p>{car.location}</p>
            <div className="flow-buy-price">
              <strong>{car.price}</strong>
              <span>{car.condition}</span>
            </div>
            <div className="flow-buy-actions">
              <button type="button">Buy now</button>
              <button type="button" aria-label="Save">
                <Bookmark size={20} aria-hidden="true" />
              </button>
            </div>
            <button className="flow-secondary-action" type="button">
              Schedule test drive
            </button>
            <div className="flow-stat-grid flow-stat-grid-compact">
              <Stat label="Year" value={String(car.year)} />
              <Stat label="Fuel" value={car.fuel} />
              <Stat label="Range" value={car.range} />
              <Stat label="Mileage" value={car.mileage ?? "—"} />
            </div>
          </aside>
        </div>
      </div>
    </FlowRydShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flow-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Review({ name, when, text }: { name: string; when: string; text: string }) {
  return (
    <article className="flow-review">
      <div>
        <span>{name[0]}</span>
        <div>
          <strong>
            {name} <em>{when}</em>
          </strong>
          <small>San Francisco, CA</small>
        </div>
      </div>
      <p>{text}</p>
    </article>
  );
}
