import { prisma } from '@/server/db';
import { xeroRequest, XeroApiError } from '@/server/integrations/xero';

type TrackingCategory = {
  TrackingCategoryID: string;
  Name: string;
  Status: string;
  Options?: Array<{ TrackingOptionID: string; Name: string; Status: string }>;
};

type TrackingCategoryResponse = { TrackingCategories: TrackingCategory[] };
type TrackingOptionResponse = {
  Options: Array<{ TrackingOptionID: string; Name: string; Status: string }>;
};

const CATEGORY_NAME = 'Projects';

/**
 * Ensure a "Projects" tracking category exists and has an option for this
 * project code. Writes back the option value on Project.xeroTrackingCategoryValue.
 * Idempotent — safe to call on every project create or manual sync.
 */
export async function ensureProjectTrackingOption(projectId: string): Promise<string> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { id: true, code: true, xeroTrackingCategoryValue: true },
  });

  // 1. Find or create the "Projects" tracking category.
  const cats = await xeroRequest<TrackingCategoryResponse>(
    'GET',
    `/api.xro/2.0/TrackingCategories?where=Name%3D%3D%22${encodeURIComponent(CATEGORY_NAME)}%22`,
  );
  let category = cats.TrackingCategories[0];
  if (!category) {
    const created = await xeroRequest<TrackingCategoryResponse>(
      'PUT',
      '/api.xro/2.0/TrackingCategories',
      { TrackingCategories: [{ Name: CATEGORY_NAME }] },
    );
    category = created.TrackingCategories[0];
    if (!category) throw new Error('Xero returned no tracking category');
  }

  // 2. Find or create the option for this project code.
  const existingOpt = category.Options?.find((o) => o.Name === project.code);
  if (existingOpt) {
    if (project.xeroTrackingCategoryValue !== existingOpt.TrackingOptionID) {
      await prisma.project.update({
        where: { id: project.id },
        data: { xeroTrackingCategoryValue: existingOpt.TrackingOptionID },
      });
    }
    return existingOpt.TrackingOptionID;
  }

  try {
    const optRes = await xeroRequest<TrackingOptionResponse>(
      'PUT',
      `/api.xro/2.0/TrackingCategories/${category.TrackingCategoryID}/Options`,
      { Options: [{ Name: project.code }] },
    );
    const option = optRes.Options[0];
    if (!option) throw new Error('Xero returned no option');
    await prisma.project.update({
      where: { id: project.id },
      data: { xeroTrackingCategoryValue: option.TrackingOptionID },
    });
    return option.TrackingOptionID;
  } catch (err) {
    // 409/400 "already exists" can happen in a race — re-read the category
    // and pick up the option that was just created.
    if (err instanceof XeroApiError && (err.status === 400 || err.status === 409)) {
      const retry = await xeroRequest<TrackingCategoryResponse>(
        'GET',
        `/api.xro/2.0/TrackingCategories/${category.TrackingCategoryID}`,
      );
      const opt = retry.TrackingCategories[0]?.Options?.find((o) => o.Name === project.code);
      if (opt) {
        await prisma.project.update({
          where: { id: project.id },
          data: { xeroTrackingCategoryValue: opt.TrackingOptionID },
        });
        return opt.TrackingOptionID;
      }
    }
    throw err;
  }
}
