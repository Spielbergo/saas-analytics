// Supabase/PostgREST returns at most 1,000 rows per request (the project's
// "max rows" setting), silently truncating bigger tables. This pages through
// with .range() until a page comes back empty. It advances by the number of
// rows actually returned, so it still works if the server's cap is lower than
// our page size. Queries MUST have a deterministic .order() or pages can
// overlap/skip.

type PageResult<T> = { data: T[] | null; error: { message?: string } | null };

export async function pageAll<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  opts: { pageSize?: number; maxRows?: number } = {}
): Promise<{ data: T[]; error: { message?: string } | null }> {
  const pageSize = opts.pageSize ?? 1000;
  const maxRows = opts.maxRows ?? 200_000; // runaway guard
  const all: T[] = [];
  let from = 0;
  while (all.length < maxRows) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) return { data: all, error };
    if (!data || data.length === 0) break;
    all.push(...data);
    from += data.length;
  }
  return { data: all, error: null };
}
