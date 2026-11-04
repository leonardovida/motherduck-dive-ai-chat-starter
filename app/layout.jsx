import { headers } from "next/headers";
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

// Applies a stored dark theme before the first paint, so a dark page does not flash light while
// the app loads. The app keeps the class in step afterwards.
const THEME_SCRIPT = 'try{if(localStorage.getItem("dive_app_theme")==="dark"){document.documentElement.classList.add("dark");document.documentElement.style.colorScheme="dark"}}catch(e){}';

export default async function RootLayout({ children }) {
  // proxy.js sets a fresh nonce per request; the content security policy allows only that script.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>
      <body>{children}</body>
    </html>
  );
}
