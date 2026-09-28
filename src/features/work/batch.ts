// Keep successful writes and retain failed items for an explicit retry.
export async function applyBatch<T extends { id: string }>(
  records: T[],
  write: (record: T) => Promise<unknown>,
) {
  const succeeded: string[] = [];
  const failed: string[] = [];
  for (const record of records) {
    try {
      await write(record);
      succeeded.push(record.id);
    } catch {
      failed.push(record.id);
    }
  }
  return { succeeded, failed };
}
