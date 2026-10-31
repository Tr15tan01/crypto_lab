"use client";

import { usePathname } from "next/navigation";
import { MotionConfig, motion } from "motion/react";

/** A short, subtle fade between pages. Disabled for users who prefer reduced motion. */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </MotionConfig>
  );
}
