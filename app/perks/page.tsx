import { Gift, PlugZap, Truck, Zap } from "lucide-react";
import { WebShell } from "@/components/WebShell";

export const revalidate = 3600;

export const metadata = {
  title: "Perks — FlowRyd",
};

const perks = [
  {
    icon: Gift,
    title: "$7,500 EV tax credit",
    body: "Federal incentive applied automatically to eligible EVs at checkout.",
  },
  {
    icon: PlugZap,
    title: "Free home charger install",
    body: "Get a Level 2 charger installed when you finance through FlowRyd.",
  },
  {
    icon: Zap,
    title: "1 year of fast charging",
    body: "Complimentary charging at 60,000+ stations across the country.",
  },
  {
    icon: Truck,
    title: "Concierge delivery",
    body: "We deliver to your door and walk you through every feature.",
  },
];

export default function PerksPage() {
  return (
    <WebShell>
      <div className="mx-auto max-w-7xl w-full px-6 lg:px-10 py-10">
        <header className="mb-8 max-w-2xl">
          <h1 className="font-display font-extrabold text-3xl">Perks</h1>
          <p className="text-muted-foreground mt-1">
            Every FlowRyd purchase comes loaded with incentives that pay you back.
          </p>
        </header>

        <div className="grid sm:grid-cols-2 gap-5">
          {perks.map(({ icon: Icon, title, body }) => (
            <article
              key={title}
              className="rounded-3xl bg-background border border-border p-6 flex gap-4 hover:border-foreground/20 hover:shadow-[0_10px_30px_-15px_rgba(40,40,80,0.18)] transition-all"
            >
              <div className="size-12 shrink-0 rounded-2xl bg-primary/15 text-primary flex items-center justify-center">
                <Icon className="size-6" aria-hidden="true" />
              </div>
              <div>
                <h2 className="font-display font-bold text-lg">{title}</h2>
                <p className="text-muted-foreground mt-1">{body}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </WebShell>
  );
}
