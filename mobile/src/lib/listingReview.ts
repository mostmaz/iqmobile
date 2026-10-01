// The quality-gate status, as the app reads it. Pure: what to show for each
// state, and how to wait for one that is still being decided.
import type { ReviewState } from '../api/endpoints';

/** Nothing left to wait for. */
export function reviewSettled(state: ReviewState | null | undefined): boolean {
  return state === 'published' || state === 'under_review' || state === 'rejected';
}

/**
 * How long to wait before asking again, from how long we have waited. The
 * model answers in 5–20 s; the vendor deadline is a minute. Quick at first,
 * then slower — and after `giveUpMs` the screen stops asking and the push
 * does the rest.
 */
export const REVIEW_GIVE_UP_MS = 75_000;
export function reviewPollDelay(elapsedMs: number): number | null {
  if (elapsedMs >= REVIEW_GIVE_UP_MS) return null;
  if (elapsedMs < 10_000) return 1_500;
  if (elapsedMs < 30_000) return 2_500;
  return 4_000;
}

export type ReviewCopy = {
  title: string;
  body: string;
  tone: 'checking' | 'pending' | 'success' | 'danger';
};

/** The headline and the one paragraph under it, per state. */
export function reviewCopy(state: ReviewState | 'timeout', reason?: string | null): ReviewCopy {
  const why = reason ? `\n\nالسبب: ${reason}` : '';
  switch (state) {
    case 'checking':
      return {
        tone: 'checking',
        title: 'نفحص إعلانك',
        body: 'الذكاء الاصطناعي يراجع الصور والوصف الآن. يأخذ هذا ثوانٍ قليلة.',
      };
    case 'timeout':
      return {
        tone: 'pending',
        title: 'الفحص يأخذ وقتاً أطول من المعتاد',
        body: 'ما في داعي للانتظار هنا — يصلك تنبيه فور انتهاء الفحص، وتجد الإعلان في «إعلاناتي».',
      };
    case 'under_review':
      return {
        tone: 'pending',
        title: 'إعلانك قيد المراجعة',
        body: `الفحص الآلي وجد ما يستدعي نظرة من فريقنا، فالإعلان مخفي عن المشترين الآن. سنراجعه بأسرع وقت ويصلك تنبيه بالنتيجة — نشراً أو رفضاً.${why}`,
      };
    case 'published':
      return {
        tone: 'success',
        title: 'إعلانك منشور',
        body: 'الإعلان ظاهر للمشترين الآن — بصوره.',
      };
    case 'rejected':
      return {
        tone: 'danger',
        title: 'لم يُنشر إعلانك',
        body: `راجع فريقنا الإعلان وقرر عدم نشره لأن حالة الجهاز غير مناسبة للعرض هنا.${why}`,
      };
    default:
      return { tone: 'pending', title: 'إعلانك', body: '' };
  }
}
