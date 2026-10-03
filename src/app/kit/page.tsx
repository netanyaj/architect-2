import { notFound } from "next/navigation";
import { KitDemo } from "./kit-demo";

/** Dev-only component gallery for checking the ax kit against the design system. */
export default function KitPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <KitDemo />;
}
