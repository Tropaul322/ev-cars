import { Gift, PlugZap, Truck, Zap } from "lucide-react";
import { FlowRydShell } from "@/components/flowryd-demo-shell";

export const metadata = {
  title: "Perks — FlowRyd"
};

const perks = [
  {
    icon: Gift,
    title: "$7,500 EV tax credit",
    body: "Federal incentive applied automatically to eligible EVs at checkout."
  },
  {
    icon: PlugZap,
    title: "Free home charger install",
    body: "Get a Level 2 charger installed when you finance through FlowRyd."
  },
  {
    icon: Zap,
    title: "1 year of fast charging",
    body: "Complimentary charging at 60,000+ stations across the country."
  },
  {
    icon: Truck,
    title: "Concierge delivery",
    body: "We deliver to your door and walk you through every feature."
  }
];

export default function PerksPage() {
  return (
    <FlowRydShell>
      <div className="flow-page">
        <header className="flow-page-header flow-page-header-narrow">
          <h1>Perks</h1>
          <p>Every FlowRyd purchase comes loaded with incentives that pay you back.</p>
        </header>

        <div className="flow-perks-grid">
          {perks.map(({ icon: Icon, title, body }) => (
            <article className="flow-perk-card" key={title}>
              <span className="feature-icon">
                <Icon size={24} aria-hidden="true" />
              </span>
              <div>
                <h2>{title}</h2>
                <p>{body}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </FlowRydShell>
  );
}
