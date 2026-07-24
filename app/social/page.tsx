import Image from "next/image";
import { WebShell } from "@/components/WebShell";

export const revalidate = 3600;

export const metadata = {
  title: "Social — FlowRyd",
};

const avatar = (n: number) => `https://i.pravatar.cc/160?img=${n}`;
const avatars = [1, 3, 5, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 25, 26, 28, 29, 30, 31, 32, 33, 34, 36, 38].map(
  avatar,
);
const testimonials = [
  {
    user: "Mia, Model Y owner",
    photo: avatar(47),
    quote:
      "Just picked up my new Model Y in Pearl White. FlowRyd made the whole thing feel like ordering a really nice coffee — I picked what I wanted, and it showed up.",
  },
  {
    user: "Jose, Model 3 owner",
    photo: avatar(52),
    quote:
      "Six months in. Software keeps improving, range is honest, and the charging network alone is worth it. Happy to answer questions from anyone on the fence.",
  },
  {
    user: "Alex, Rivian R1S owner",
    photo: avatar(60),
    quote:
      "Road-tripped Big Sur with four people and the AC blasting. 390 miles of range held up beautifully — and every charging stop was somewhere I actually wanted to be.",
  },
  {
    user: "Noor, LYRIQ owner",
    photo: avatar(48),
    quote: "My electricity bill went up $28 a month. My gas bill went to $0. The math is, frankly, mathing.",
  },
  {
    user: "Sam, Model 3 owner",
    photo: avatar(64),
    quote:
      "FlowRyd concierge delivered the car straight to my office. I signed two things, took a photo, and drove home. That was the whole experience.",
  },
];

export default function SocialPage() {
  return (
    <WebShell>
      <div className="mx-auto max-w-4xl w-full px-6 py-16 sm:py-24">
        <header className="text-center">
          <h1 className="font-display font-extrabold text-4xl sm:text-5xl leading-[1.05] tracking-tight">
            Stories from real
            <br />
            FlowRyd owners.
          </h1>
        </header>

        <div className="mt-12 sm:mt-16 flex flex-wrap justify-center gap-2 sm:gap-2.5 max-w-3xl mx-auto" aria-hidden="true">
          {avatars.map((src, index) => (
            <Image
              src={src}
              alt=""
              width={48}
              height={48}
              key={`${src}-${index}`}
              unoptimized
              className="size-11 sm:size-12 rounded-full object-cover ring-1 ring-border"
            />
          ))}
        </div>

        <div className="mt-24 sm:mt-32 space-y-20 sm:space-y-28">
          {testimonials.map((testimonial, index) => (
            <figure className="text-center" key={testimonial.user}>
              <blockquote className="font-display font-medium text-2xl sm:text-3xl leading-[1.3] tracking-tight text-foreground max-w-3xl mx-auto">
                “{testimonial.quote}”
              </blockquote>
              <Image
                src={testimonial.photo}
                alt=""
                width={32}
                height={32}
                unoptimized
                className="mt-8 mx-auto size-8 rounded-full object-cover ring-1 ring-border"
              />
              <figcaption className="mt-4 text-sm font-semibold tracking-wide uppercase text-muted-foreground">
                {testimonial.user}
              </figcaption>
              {index < testimonials.length - 1 ? (
                <div className="mt-20 sm:mt-28 mx-auto max-w-2xl border-t border-border" />
              ) : null}
            </figure>
          ))}
        </div>
      </div>
    </WebShell>
  );
}
