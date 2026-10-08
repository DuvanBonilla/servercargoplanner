import { FeedingStatus } from '@prisma/client';

export const FEEDING_TYPE_NAMES: Record<FeedingStatus, string> = {
  BREAKFAST: 'desayuno',
  LUNCH: 'almuerzo',
  DINNER: 'cena',
  SNACK: 'refrigerio',
};
