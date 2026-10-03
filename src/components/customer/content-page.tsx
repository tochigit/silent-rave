import { publicPage } from "@/lib/content/pages";
import { ContactForm } from "./contact-form";
export async function ContentPage({ slug }: { slug: "about" | "contact" }) {
  const page = await publicPage(slug);
  return (
    <section className="narrow stack">
      <p className="eyebrow">SILENT RAVE</p>
      <h1>
        {page?.title ?? (slug === "about" ? "About Silent Rave" : "Contact")}
      </h1>
      {page ? (
        <div className="prose">{page.body}</div>
      ) : (
        <div className="panel">
          <p>
            {slug === "about"
              ? "Our story will appear here when it is published."
              : "Contact information has not been published yet."}
          </p>
        </div>
      )}
      {slug === "contact" && page && <ContactForm />}
    </section>
  );
}
