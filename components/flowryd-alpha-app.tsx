"use client";

import { ShieldCheck, Sparkles, Zap } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Composer } from "@/components/Composer";
import { WebShell } from "@/components/WebShell";

export function FlowRydAlphaApp() {
  const router = useRouter();

  function startChat(query: string) {
    const trimmed = query.trim();
    if (!trimmed) return;
    router.push(`/chat?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <WebShell transparentHeader>
      <section className="relative isolate pt-[7.25rem] md:pt-16">
        <div className="absolute inset-x-0 top-[-7.25rem] bottom-0 md:top-[-4rem] -z-10">
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

        <div className="relative z-10 mx-auto max-w-5xl px-6 pt-24 pb-32 text-center md:pt-40">
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
              placeholder="Ask anything... e.g. 'a family SUV under €60k'"
              onSubmit={(value) => startChat(value)}
            />
          </div>

          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {[
              "Family SUV under €60k",
              "Best for long commutes",
              "Used Tesla Model 3",
              "Compact city EV",
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
            body: "We surface available credits and incentives right at the price.",
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
    </WebShell>
  );
}
