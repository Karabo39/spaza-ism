"use client";
import { useEffect, useState } from "react";

/** Wait for typing to pause before starting a new search. */
export function useDebouncedValue<T>(value: T, delay = 220) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
