"use client";

import * as React from "react";
import { ShieldCheck, Sparkles, Zap } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Composer } from "@/components/Composer";
import { WebShell } from "@/components/WebShell";
import { SaveCarButton } from "@/components/save-car-button";
import type { SavedCarSnapshot } from "@/lib/repositories/saved-car-repository";

const trendingMatches = [
  {
    id: "tesla-model-y",
    make: "Tesla",
    model: "Model Y",
    location: "San Francisco, CA",
    price: "$52,490",
    condition: "New",
    match: 100,
    image: "/flowryd/car-tesla-y.jpg",
  },
  {
    id: "cadillac-lyriq",
    make: "Cadillac",
    model: "LYRIQ 2024",
    location: "San Francisco, CA",
    price: "$60,695",
    condition: "New",
    match: 100,
    image: "/flowryd/car-cadillac.jpg",
  },
  {
    id: "tesla-model-3",
    make: "Tesla",
    model: "Model 3",
    location: "San Francisco, CA",
    price: "$38,630",
    condition: "Used",
    match: 92,
    image: "/flowryd/car-tesla-3.jpg",
  },
  {
    id: "rivian-r1s",
    make: "Rivian",
    model: "R1S",
    location: "Los Angeles, CA",
    price: "$77,400",
    condition: "New",
    match: 88,
    image: "/flowryd/car-rivian.jpg",
  },
];

export function FlowRydAlphaApp() {
  const router = useRouter();

  function startChat(query: string) {
    const trimmed = query.trim();
    if (!trimmed) return;
    router.push(`/chat?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <WebShell transparentHeader>
      <section className="relative -mt-16">
        <div className="absolute inset-0 z-0">
          <Image
            src="/flowryd/hero-gradient.jpg"
            alt=""
            fill
            priority
            className="object-cover"
            sizes="100vw"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-background" />
        </div>

        <div className="relative z-10 mx-auto max-w-5xl px-6 pt-40 pb-32 text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/15 backdrop-blur text-white text-xs font-semibold px-3 py-1.5 border border-white/20">
            <Sparkles className="size-3.5" aria-hidden="true" /> AI-powered EV
            matching
          </span>
          <h1 className="mt-6 font-display font-extrabold text-white text-4xl md:text-6xl leading-[1.05] tracking-tight drop-shadow">
            The first car-buying
            <br />
            experience for your life.
          </h1>

          <div className="mt-10 max-w-2xl mx-auto">
            <Composer
              placeholder="Ask anything... e.g. 'a family SUV under $60k'"
              onSubmit={(value) => startChat(value)}
            />
          </div>

          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {[
              "Family SUV under $60k",
              "Best for long commutes",
              "Used Tesla Model 3",
              "Lease for $500/mo",
            ].map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => startChat(prompt)}
                className="rounded-lg bg-primary/40 border border-white/30 backdrop-blur text-white text-xs font-medium px-3 py-1.5 hover:bg-primary/55 shadow-sm"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section
        className="mx-auto max-w-7xl w-full px-6 lg:px-10 py-20 grid md:grid-cols-3 gap-5"
        aria-label="FlowRyd benefits"
      >
        {[
          {
            icon: Sparkles,
            title: "Matched to your life",
            body: "Conversational discovery that learns what actually matters to you.",
          },
          {
            icon: Zap,
            title: "EV incentives, applied",
            body: "We surface federal & state credits up to $7,500 right at the price.",
          },
          {
            icon: ShieldCheck,
            title: "Concierge delivery",
            body: "Your car comes to your driveway, fully set up. No dealership.",
          },
        ].map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-3xl bg-muted p-6">
            <div className="size-11 rounded-2xl bg-primary/15 text-primary flex items-center justify-center">
              <Icon className="size-5" aria-hidden="true" />
            </div>
            <h2 className="mt-4 font-display font-bold text-lg">{title}</h2>
            <p className="text-muted-foreground mt-1.5 text-[15px]">{body}</p>
          </div>
        ))}
      </section>

      <section
        className="mx-auto max-w-7xl w-full px-6 lg:px-10 pb-20"
        aria-label="Trending matches"
      >
        <div className="flex items-end justify-between mb-6">
          <h2 className="font-display font-extrabold text-3xl">
            Trending matches
          </h2>
          <Link
            href="/saved"
            className="text-sm font-semibold text-primary hover:underline"
          >
            View all →
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {trendingMatches.map((vehicle) => (
            <article
              key={vehicle.id}
              className="group rounded-3xl bg-muted overflow-hidden hover:shadow-[0_20px_50px_-20px_rgba(40,40,80,0.25)] transition-shadow"
            >
              <div className="relative">
                <Link
                  href={`/car/${vehicle.id}`}
                  aria-label={`Open ${vehicle.make} ${vehicle.model}`}
                >
                  <Image
                    src={vehicle.image}
                    alt={`${vehicle.make} ${vehicle.model}`}
                    width={720}
                    height={540}
                    className="w-full h-48 object-cover group-hover:scale-105 transition-transform duration-500"
                    sizes="(max-width: 720px) calc(100vw - 32px), 290px"
                  />
                </Link>
                <span className="absolute top-3 left-3 bg-match text-match-foreground text-xs font-semibold px-3 py-1.5 rounded-full">
                  {vehicle.match}% match
                </span>
                <SaveCarButton
                  vehicleId={vehicle.id}
                  snapshot={snapshotFromTrendingMatch(vehicle)}
                  className="absolute top-3 right-3 size-9 rounded-full bg-white flex items-center justify-center shadow text-foreground"
                  activeClassName="text-primary"
                />
              </div>
              <Link className="block p-4" href={`/car/${vehicle.id}`}>
                <h3 className="font-display font-bold">
                  {vehicle.make} {vehicle.model}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {vehicle.location}
                </p>
                <div className="mt-3 flex items-end justify-between">
                  <div className="font-display font-bold">{vehicle.price}</div>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-accent text-accent-foreground">
                    {vehicle.condition}
                  </span>
                </div>
              </Link>
            </article>
          ))}
        </div>
      </section>
    </WebShell>
  );
}

function snapshotFromTrendingMatch(
  vehicle: (typeof trendingMatches)[number],
): SavedCarSnapshot {
  return {
    id: vehicle.id,
    name: `${vehicle.make} ${vehicle.model}`,
    make: vehicle.make,
    model: vehicle.model,
    price: vehicle.price,
    condition: vehicle.condition,
    location: vehicle.location,
    image: vehicle.image,
    match: vehicle.match,
  };
}
