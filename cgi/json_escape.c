/**************************************************************************
 *
 * JSON_ESCAPE.C - String escaping for Nagios CGI JSON output
 *
 * License:
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 2 as
 * published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 675 Mass Ave, Cambridge, MA 02139, USA.
 *************************************************************************/

#include <stddef.h>
#include <stdlib.h>
#include <string.h>

#include "../include/json_escape.h"

/* Multiplier to increment the buffer in json_escape_string() to avoid frequent
	repeated reallocations */
#define BUF_REALLOC_MULTIPLIER 16

static const json_escape_pair string_escape_pairs[] = {
	{ "\\", "\\\\" },
	{ "\x01", "\\u0001" },
	{ "\x02", "\\u0002" },
	{ "\x03", "\\u0003" },
	{ "\x04", "\\u0004" },
	{ "\x05", "\\u0005" },
	{ "\x06", "\\u0006" },
	{ "\a", "\\a" },
	{ "\b", "\\b" },
	{ "\t", "\\t" },
	{ "\n", "\\n" },
	{ "\v", "\\v" },
	{ "\f", "\\f" },
	{ "\r", "\\r" },
	{ "\x0e", "\\u000e" },
	{ "\x0f", "\\u000f" },
	{ "\x10", "\\u0010" },
	{ "\x11", "\\u0011" },
	{ "\x12", "\\u0012" },
	{ "\x13", "\\u0013" },
	{ "\x14", "\\u0014" },
	{ "\x15", "\\u0015" },
	{ "\x16", "\\u0016" },
	{ "\x17", "\\u0017" },
	{ "\x18", "\\u0018" },
	{ "\x19", "\\u0019" },
	{ "\x1a", "\\u001a" },
	{ "\x1b", "\\u001b" },
	{ "\x1c", "\\u001c" },
	{ "\x1d", "\\u001d" },
	{ "\x1e", "\\u001e" },
	{ "\x1f", "\\u001f" },
	{ "\"", "\\\"" },
};

const json_escape string_escapes = {
	(sizeof(string_escape_pairs) / sizeof(string_escape_pairs[0])),
	string_escape_pairs
};

static const json_escape_pair percent_escape_pairs[] = {
	{ "%", "%%" },
};

const json_escape percent_escapes = {
	(sizeof(percent_escape_pairs) / sizeof(percent_escape_pairs[0])),
	percent_escape_pairs
};

/* Escape a string based on the values in the escapes parameter.
 *
 * This operates directly on the raw bytes of src: every "from" pattern
 * in the tables above is a single-byte ASCII character (0x00-0x7f), and
 * such a byte can never occur as part of a multi-byte UTF-8 sequence
 * (whose bytes are always >= 0x80), so scanning/replacing at the byte
 * level is exactly equivalent to scanning/replacing at the character
 * level for valid UTF-8 input -- without needing to decode it. Bytes
 * that don't form valid UTF-8 are simply passed through unchanged,
 * rather than being rejected, which is a caller concern (if any). */
char *json_escape_string(const char *src, const json_escape *escapes) {

	char	*dest;		/* buffer being built up into the escaped string */
	size_t	dest_size;	/* bytes usable in dest, not counting the NUL */
	size_t	dest_len;	/* bytes currently used in dest, not counting the NUL */
	int		x;
	const json_escape_pair	*escp;	/* pointer to current escape pair */
	size_t	from_len;
	size_t	to_len;
	char	*fromp;		/* pointer to a found "from" string within dest */
	size_t	offset;		/* offset from beginning of dest to a "from" string */
	size_t	tail;		/* bytes at/after the match, incl. the NUL, to shift */
	char	*dest_new;

	/* Make sure we're passed valid parameters */
	if((NULL == src) || (NULL == escapes)) {
		return NULL;
		}

	dest_len = strlen(src);
	dest_size = dest_len;
	if((dest = malloc(dest_size + 1)) == NULL) {
		return NULL;
		}
	memcpy(dest, src, dest_len + 1);

	/* Process each escape pair */
	for(x = 0, escp = escapes->pairs; x < escapes->count; x++, escp++) {
		from_len = strlen(escp->from);
		to_len = strlen(escp->to);
		fromp = dest;
		while((fromp = strstr(fromp, escp->from)) != NULL) {
			offset = (size_t)(fromp - dest);

			if((to_len > from_len) &&
					((dest_size - dest_len) < (to_len - from_len))) {
				/* If more room is needed, realloc and update variables */
				dest_size += (to_len - from_len) * BUF_REALLOC_MULTIPLIER;
				if((dest_new = realloc(dest, dest_size + 1)) == NULL) {
					free(dest);
					return NULL;
					}
				dest = dest_new;
				fromp = dest + offset;
				}

			tail = dest_len - offset - from_len + 1; /* incl. terminating NUL */
			memmove(fromp + to_len, fromp + from_len, tail);
			memcpy(fromp, escp->to, to_len);
			dest_len += (to_len - from_len);
			fromp += to_len;
			}
		}

	return dest;
	}
