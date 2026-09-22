/**************************************************************************
 *
 * JSON_ESCAPE.H - String escaping for Nagios CGI JSON output
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

#ifndef NAGIOS_JSON_ESCAPE_H_INCLUDED
#define NAGIOS_JSON_ESCAPE_H_INCLUDED

/* String escaping structures.
 *
 * This header and its implementation (json_escape.c) intentionally have
 * no dependency on anything else in Nagios: json_escape_string() works
 * on raw bytes only, never on wide characters, so its behavior cannot be
 * affected by the process's current locale (which, for a Nagios CGI, is
 * itself derived from the client-supplied Accept-Language header -- see
 * process_language() in getcgi.c -- and so is not something a security
 * boundary should depend on). */
typedef struct json_escape_pair_struct {
	const char *from;
	const char *to;
}	json_escape_pair;

typedef struct json_escape_struct {
	const int				count;
	const json_escape_pair	*pairs;
}	json_escape;

/* Escapes required to embed a string as a JSON string value: backslash,
 * double-quote, and the C0 control characters. */
extern const json_escape string_escapes;

/* Escapes '%' so a string can safely be passed through a printf-style
 * format string without being interpreted as a conversion specifier. */
extern const json_escape percent_escapes;

extern char *json_escape_string(const char *, const json_escape *);

#endif
