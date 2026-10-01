// A successful write must not be reported as failed when the subsequent GET fails.
export async function executeProductMutation<T>(
  mutate: () => Promise<T>,
  refresh: () => Promise<unknown>,
): Promise<{ result: T; refreshed: boolean }> {
  const result = await mutate();
  try {
    await refresh();
    return { result, refreshed: true };
  } catch {
    return { result, refreshed: false };
  }
}
