import Image from "next/image";
import { FlowRydShell } from "@/components/flowryd-demo-shell";

export const metadata = {
  title: "Social — FlowRyd"
};

const avatar = (n: number) => `https://i.pravatar.cc/160?img=${n}`;
const avatars = [1, 3, 5, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 25, 26, 28, 29, 30, 31, 32, 33, 34, 36, 38].map(avatar);
const testimonials = [
  {
    user: "Mia, Model Y owner",
    photo: avatar(47),
    quote:
      "Just picked up my new Model Y in Pearl White. FlowRyd made the whole thing feel like ordering a really nice coffee."
  },
  {
    user: "Jose, Model 3 owner",
    photo: avatar(52),
    quote:
      "Six months in. Software keeps improving, range is honest, and the charging network alone is worth it."
  },
  {
    user: "Alex, Rivian R1S owner",
    photo: avatar(60),
    quote:
      "Road-tripped Big Sur with four people and the AC blasting. 390 miles of range held up beautifully."
  },
  {
    user: "Noor, LYRIQ owner",
    photo: avatar(48),
    quote: "My electricity bill went up $28 a month. My gas bill went to $0. The math is, frankly, mathing."
  }
];

export default function SocialPage() {
  return (
    <FlowRydShell>
      <div className="flow-social-page">
        <header className="flow-social-header">
          <h1>
            Stories from real
            <br />
            FlowRyd owners.
          </h1>
        </header>

        <div className="flow-avatar-cloud" aria-hidden="true">
          {avatars.map((src, index) => (
            <Image src={src} alt="" width={48} height={48} key={`${src}-${index}`} unoptimized />
          ))}
        </div>

        <div className="flow-testimonials">
          {testimonials.map((testimonial, index) => (
            <figure className="flow-testimonial" key={testimonial.user}>
              <blockquote>“{testimonial.quote}”</blockquote>
              <Image src={testimonial.photo} alt="" width={32} height={32} unoptimized />
              <figcaption>{testimonial.user}</figcaption>
              {index < testimonials.length - 1 ? <div className="flow-testimonial-divider" /> : null}
            </figure>
          ))}
        </div>
      </div>
    </FlowRydShell>
  );
}
