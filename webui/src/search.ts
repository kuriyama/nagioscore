/**
 * One matching function shared by host and service search, unlike the old
 * cgi/status.c navbarsearch/servicefilter logic which mixed exact-match,
 * prefix-match and case-sensitive-vs-insensitive regex depending on the
 * field being searched. Behavior here is intentionally simple and uniform:
 *
 *  - default: case-insensitive substring match
 *  - if the query contains `*`, it's treated as a wildcard (translated to
 *    `.*` in a regex); everything else in the query is matched literally
 *    (escaped), so unlike the old code other regex metacharacters don't
 *    leak through unintentionally.
 */

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildMatcher(query: string): (candidate: string) => boolean {
	const trimmed = query.trim();
	if (trimmed === '') {
		return () => false;
	}

	if (trimmed.includes('*')) {
		const pattern = trimmed
			.split('*')
			.map(escapeRegExp)
			.join('.*');
		const re = new RegExp(pattern, 'i');
		return (candidate) => re.test(candidate);
	}

	const needle = trimmed.toLowerCase();
	return (candidate) => candidate.toLowerCase().includes(needle);
}
