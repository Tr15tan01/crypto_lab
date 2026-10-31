import type { ObjectId } from "mongodb";

/** The JSON shape of a server document: ObjectIds and Dates become strings. */
export type Serialized<T> = T extends ObjectId
  ? string
  : T extends Date
    ? string
    : T extends Map<infer K, infer V>
      ? Record<K & string, Serialized<V>>
      : T extends Array<infer U>
        ? Array<Serialized<U>>
        : T extends object
          ? { [K in keyof T]: Serialized<T[K]> }
          : T;

/** Converts a server value to its JSON shape (as it will arrive in the browser). */
export function serialize<T>(value: T): Serialized<T> {
  return JSON.parse(JSON.stringify(value)) as Serialized<T>;
}
