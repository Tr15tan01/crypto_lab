"use client";

import NextLink from "next/link";
import { useState } from "react";

/**
 * The app's link: same as next/link, but a route is pre-loaded only once the pointer, finger or
 * keyboard focus reaches the link, not whenever it is merely visible.
 *
 * Pages here refresh themselves every minute, and after each refresh Next.js would pre-load
 * every visible link again (the menu, every coin in a table): dozens of wasted server requests
 * a minute. This keeps navigation fast without that background load.
 */
export default function Link({ prefetch, onMouseEnter, onTouchStart, onFocus, ...props }: React.ComponentProps<typeof NextLink>) {
  const [active, setActive] = useState(false);
  return (
    <NextLink
      {...props}
      prefetch={prefetch ?? (active ? null : false)}
      onMouseEnter={(e) => {
        setActive(true);
        onMouseEnter?.(e);
      }}
      onTouchStart={(e) => {
        setActive(true);
        onTouchStart?.(e);
      }}
      onFocus={(e) => {
        setActive(true);
        onFocus?.(e);
      }}
    />
  );
}
