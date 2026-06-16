"use client";

import {
  ArrowUp,
  Bookmark,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  Users,
  Zap
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { DemoAuthButton } from "@/components/demo-auth-button";
import { SaveCarButton } from "@/components/save-car-button";
import { requireDemoAccess } from "@/lib/demo-access-client";
import type { SavedCarSnapshot } from "@/lib/repositories/saved-car-repository";

const starterPrompts = [
  "Family SUV under $60k",
  "Best for long commutes",
  "Used Tesla Model 3",
  "Lease for $500/mo"
];

const trendingMatches = [
  {
    id: "tesla-model-y",
    make: "Tesla",
    model: "Model Y",
    location: "San Francisco, CA",
    price: "$52,490",
    condition: "New",
    match: 100,
    image: "/flowryd/car-tesla-y.jpg"
  },
  {
    id: "cadillac-lyriq",
    make: "Cadillac",
    model: "LYRIQ 2024",
    location: "San Francisco, CA",
    price: "$60,695",
    condition: "New",
    match: 100,
    image: "/flowryd/car-cadillac.jpg"
  },
  {
    id: "tesla-model-3",
    make: "Tesla",
    model: "Model 3",
    location: "San Francisco, CA",
    price: "$38,630",
    condition: "Used",
    match: 92,
    image: "/flowryd/car-tesla-3.jpg"
  },
  {
    id: "rivian-r1s",
    make: "Rivian",
    model: "R1S",
    location: "Los Angeles, CA",
    price: "$77,400",
    condition: "New",
    match: 88,
    image: "/flowryd/car-rivian.jpg"
  }
];

export function FlowRydAlphaApp() {
  const router = useRouter();
  const [heroInput, setHeroInput] = React.useState("");
  const [checkingAccess, setCheckingAccess] = React.useState(false);

  async function startChat(query: string) {
    const trimmed = query.trim();
    if (!trimmed || checkingAccess) return;

    setCheckingAccess(true);
    const allowed = await requireDemoAccess();
    setCheckingAccess(false);

    if (allowed) {
      router.push(`/chat?q=${encodeURIComponent(trimmed)}`);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand-mark" href="/" aria-label="FlowRyd search">
          <span className="brand-title">FlowRyd</span>
        </Link>
        <nav className="nav-links" aria-label="Primary">
          <Link className="nav-link nav-link-active" href="/">
            <SearchCheck size={16} aria-hidden="true" /> Search
          </Link>
          <Link className="nav-link" href="/saved">
            <Bookmark size={16} aria-hidden="true" /> Saved
          </Link>
          <Link className="nav-link" href="/social">
            <Users size={16} aria-hidden="true" /> Social
          </Link>
          <Link className="nav-link" href="/perks">
            <Zap size={16} aria-hidden="true" /> Perks
          </Link>
        </nav>
        <div className="auth-actions" aria-label="Account">
          <DemoAuthButton />
        </div>
      </header>

      <section className="hero-section" id="top">
        <div className="hero-content">
          <span className="hero-badge">
            <Sparkles size={14} aria-hidden="true" /> AI-powered EV matching
          </span>
          <h1 className="hero-title">The first car-buying experience for your life.</h1>
          <form
            className="hero-search"
            onSubmit={(event) => {
              event.preventDefault();
              void startChat(heroInput);
            }}
          >
            <input
              className="hero-search-input"
              value={heroInput}
              onChange={(event) => setHeroInput(event.target.value)}
              placeholder="Ask anything... e.g. 'a family SUV under $60k'"
              aria-label="Ask FlowRyd for EV matches"
            />
            <div className="hero-search-actions">
              <button
                className="hero-submit-button"
                type="submit"
                aria-label="Send"
                disabled={!heroInput.trim() || checkingAccess}
              >
                <ArrowUp size={16} aria-hidden="true" />
              </button>
            </div>
          </form>
          <div className="hero-prompt-row" aria-label="Example searches">
            {starterPrompts.map((prompt) => (
              <button
                key={prompt}
                className="hero-prompt"
                type="button"
                onClick={() => void startChat(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="feature-band" id="perks" aria-label="FlowRyd benefits">
        <article className="feature-card">
          <span className="feature-icon">
            <Sparkles size={22} aria-hidden="true" />
          </span>
          <h2>Matched to your life</h2>
          <p>Conversational discovery that learns what actually matters to you.</p>
        </article>
        <article className="feature-card">
          <span className="feature-icon">
            <Zap size={22} aria-hidden="true" />
          </span>
          <h2>EV incentives, applied</h2>
          <p>We surface federal &amp; state credits up to $7,500 right at the price.</p>
        </article>
        <article className="feature-card" id="social">
          <span className="feature-icon">
            <ShieldCheck size={22} aria-hidden="true" />
          </span>
          <h2>Concierge delivery</h2>
          <p>Your car comes to your driveway, fully set up. No dealership.</p>
        </article>
      </section>

      <section className="trending-section" id="matches" aria-label="Trending matches">
        <div className="trending-header">
          <h2>Trending matches</h2>
          <Link href="/saved">View all &rarr;</Link>
        </div>
        <div className="trending-grid">
          {trendingMatches.map((vehicle) => (
            <article className="trending-card" key={vehicle.id}>
              <div className="trending-media">
                <Link href={`/car/${vehicle.id}`} aria-label={`Open ${vehicle.make} ${vehicle.model}`}>
                  <Image
                    src={vehicle.image}
                    alt={`${vehicle.make} ${vehicle.model}`}
                    width={720}
                    height={540}
                    sizes="(max-width: 720px) calc(100vw - 32px), 290px"
                  />
                </Link>
                <span className="trending-match">{vehicle.match}% match</span>
                <SaveCarButton
                  vehicleId={vehicle.id}
                  snapshot={snapshotFromTrendingMatch(vehicle)}
                  className="trending-save"
                  activeClassName="trending-save-active"
                />
              </div>
              <Link className="trending-body trending-card-link" href={`/car/${vehicle.id}`}>
                <h3>
                  {vehicle.make} {vehicle.model}
                </h3>
                <p>{vehicle.location}</p>
                <div className="trending-meta">
                  <span>{vehicle.price}</span>
                  <span>{vehicle.condition}</span>
                </div>
              </Link>
            </article>
          ))}
        </div>
      </section>

      <footer className="app-footer">
        <div className="footer-grid">
          <div>
            <h2>FlowRyd</h2>
            <p>The first car-buying experience for your life.</p>
          </div>
          <nav aria-label="Discover">
            <h3>Discover</h3>
            <a href="#">New EVs</a>
            <a href="#">Used EVs</a>
            <a href="#">Lease deals</a>
            <a href="#">Compare</a>
          </nav>
          <nav aria-label="Company">
            <h3>Company</h3>
            <a href="#">About</a>
            <a href="#">Press</a>
            <a href="#">Careers</a>
            <a href="#">Contact</a>
          </nav>
          <nav aria-label="Legal">
            <h3>Legal</h3>
            <a href="#">Privacy</a>
            <a href="#">Terms</a>
            <a href="#">Cookies</a>
          </nav>
        </div>
        <div className="footer-bottom">© 2026 FlowRyd. All rights reserved.</div>
      </footer>
    </main>
  );
}

function snapshotFromTrendingMatch(vehicle: (typeof trendingMatches)[number]): SavedCarSnapshot {
  return {
    id: vehicle.id,
    name: `${vehicle.make} ${vehicle.model}`,
    make: vehicle.make,
    model: vehicle.model,
    price: vehicle.price,
    condition: vehicle.condition,
    location: vehicle.location,
    image: vehicle.image,
    match: vehicle.match
  };
}
