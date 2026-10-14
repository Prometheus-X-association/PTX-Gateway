export const RECYCLE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface RecyclableItem {
  id: string;
  name: string;
  deletedAt?: string;
}

export const recycleExpiry = (item: RecyclableItem) => {
  const deletedAt = item.deletedAt ? Date.parse(item.deletedAt) : Number.NaN;
  return Number.isFinite(deletedAt) ? deletedAt + RECYCLE_RETENTION_MS : Number.POSITIVE_INFINITY;
};
