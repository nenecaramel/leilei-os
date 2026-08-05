import React from "react";
import type { HomeSticky } from "./home-prototype-data";

export function StickyPreview({ stickies }: { stickies: HomeSticky[] }) {
  return (
    <section className="home-section sticky-preview" aria-labelledby="sticky-preview-title">
      <div className="home-section-heading">
        <h2 id="sticky-preview-title">Sticky</h2>
      </div>
      <div className="sticky-preview-grid">
        {stickies.slice(0, 2).map((sticky) => (
          <article className={`sticky-card sticky-card-${sticky.author.toLowerCase()}`} key={sticky.id}>
            <p>{sticky.text}</p>
            <small>{sticky.author}</small>
          </article>
        ))}
      </div>
    </section>
  );
}
