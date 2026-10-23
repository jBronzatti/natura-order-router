// Raised only when routing would be pointless: an unreadable input file or no usable warehouse (D-00).
// Carries the warnings gathered before the stop, since they usually explain it.
export class RoutingStopped extends Error {
  name = "RoutingStopped";

  constructor(
    message: string,
    readonly warnings: readonly string[] = [],
  ) {
    super(message);
  }
}
