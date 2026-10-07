import type { AnchorHTMLAttributes } from "react";

// Normal document navigation works on a static host and keeps the existing UI.
export default function Link(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} />;
}
