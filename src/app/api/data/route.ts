import { requireSession } from '@/lib/auth';
import { dataFor } from '@/lib/service';
import { failure, json } from '@/lib/http';
export async function GET(req: Request) {
  try {
    const s = await requireSession(),
      p = new URL(req.url).searchParams;
    const range = Number(p.get('range') || 180);
    return json(
      await dataFor(
        s.workspaceId,
        p.get('portfolio') || undefined,
        [30, 90, 180, 365].includes(range) ? range : 180,
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
