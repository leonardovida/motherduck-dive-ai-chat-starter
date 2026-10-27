import "../src/styles.css";
import { DEFAULT_APP_TITLE } from '../src/lib/app-meta.mjs';

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return {
    title: String(process.env.APP_TITLE || DEFAULT_APP_TITLE).slice(0, 80),
    description: "Embedded MotherDuck Dives with a data chat assistant.",
    icons: { icon: "/favicon.svg" },
  };
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
