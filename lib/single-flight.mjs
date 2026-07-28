export function createSingleFlight(operation) {
  let inFlight = null;
  return function runSingleFlight() {
    if (!inFlight) {
      inFlight = Promise.resolve()
        .then(operation)
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  };
}
