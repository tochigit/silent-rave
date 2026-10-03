"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="panel narrow" role="alert">
      <h1>We couldn’t load this page</h1>
      <p>Please try again or return to your saved order link.</p>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
