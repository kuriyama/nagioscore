/*****************************************************************************
*
* This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.
*
* This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with this program.  If not, see <http://www.gnu.org/licenses/>.
*
*
*****************************************************************************/

#include <stdlib.h>
#include <string.h>
#include <locale.h>

#include "../include/json_escape.h"
#include "tap.h"

int
main() {
	char *out;
	char *out_c_locale;
	char long_ascii_then_invalid[256];
	size_t i;

	plan_tests(16);

	/* NULL parameters are rejected rather than crashing */
	ok(json_escape_string(NULL, &string_escapes) == NULL, "NULL src rejected");
	ok(json_escape_string("x", NULL) == NULL, "NULL escapes rejected");

	/* Empty string round-trips */
	out = json_escape_string("", &string_escapes);
	ok(out != NULL && strcmp(out, "") == 0, "empty string escapes to empty string");
	free(out);

	/* Plain ASCII with nothing to escape is unchanged */
	out = json_escape_string("hello world", &string_escapes);
	ok(out != NULL && strcmp(out, "hello world") == 0, "plain ASCII passes through unchanged");
	free(out);

	/* Characters requiring escaping per RFC 8259 */
	out = json_escape_string("a\\b\"c\nd\te", &string_escapes);
	ok(out != NULL && strcmp(out, "a\\\\b\\\"c\\nd\\te") == 0,
		"backslash/quote/newline/tab escaped correctly");
	free(out);

	/* \x05 must escape to \u0005, not \u0004 (regression test for a
	   copy-paste bug in the original escape table) */
	out = json_escape_string("\x05", &string_escapes);
	ok(out != NULL && strcmp(out, "\\u0005") == 0, "0x05 escapes to \\u0005");
	free(out);

	/* All C0 control characters get escaped to something, and none of
	   them are left as a raw, unescaped control byte */
	{
		int all_escaped = 1;
		for(i = 1; i <= 0x1f; i++) {
			char in[2] = { (char)i, '\0' };
			char *o = json_escape_string(in, &string_escapes);
			if((o == NULL) || (o[0] != '\\')) {
				all_escaped = 0;
				}
			free(o);
			}
		ok(all_escaped, "every C0 control character (0x01-0x1f) is escaped");
	}

	/* percent_escapes only touches '%' */
	out = json_escape_string("100% done", &percent_escapes);
	ok(out != NULL && strcmp(out, "100%% done") == 0, "percent_escapes doubles '%%'");
	free(out);

	out = json_escape_string("no percent here", &percent_escapes);
	ok(out != NULL && strcmp(out, "no percent here") == 0,
		"percent_escapes leaves non-'%%' input unchanged");
	free(out);

	/* Valid UTF-8 multibyte sequences (here:日本語, none of whose bytes
	   are in the 0x00-0x7f range used by the escape tables) pass
	   through byte-for-byte unchanged */
	out = json_escape_string("\xe6\x97\xa5\xe6\x9c\xac\xe8\xaa\x9e", &string_escapes);
	ok(out != NULL &&
		memcmp(out, "\xe6\x97\xa5\xe6\x9c\xac\xe8\xaa\x9e", 9) == 0,
		"valid UTF-8 multibyte input passes through unchanged");
	free(out);

	/*
	 * Regression test for the locale-dependent heap-buffer-overflow this
	 * function used to have: the original implementation converted src
	 * to a wchar_t buffer via mbstowcs(), whose behavior -- and whose
	 * *failure* on invalid multibyte input -- depends on the process's
	 * current locale. A Nagios CGI's locale is itself set from the
	 * client-supplied Accept-Language header (see process_language() in
	 * getcgi.c) and commonly falls back to "C" on a minimal install, so
	 * this was reachable by an unauthenticated client. Confirmed via a
	 * standalone ASan harness against the pre-fix code: feeding a long
	 * ASCII prefix followed by invalid UTF-8 bytes under the "C" locale
	 * produced a heap-buffer-overflow WRITE inside mbstowcs().
	 *
	 * The fixed implementation never decodes multibyte characters at
	 * all (see the comment on json_escape_string() in json_escape.c),
	 * so it must behave identically regardless of locale.
	 */
	for(i = 0; i < 200; i++) {
		long_ascii_then_invalid[i] = 'A';
		}
	long_ascii_then_invalid[200] = '\x80';
	long_ascii_then_invalid[201] = '\x80';
	long_ascii_then_invalid[202] = '\x80';
	long_ascii_then_invalid[203] = '\0';

	setlocale(LC_ALL, "C");
	out_c_locale = json_escape_string(long_ascii_then_invalid, &string_escapes);
	ok(out_c_locale != NULL, "invalid multibyte input under \"C\" locale does not crash "
		"and does not fail");
	ok(out_c_locale != NULL && memcmp(out_c_locale, long_ascii_then_invalid, 203) == 0,
		"invalid multibyte bytes pass through unchanged under \"C\" locale");

	/* Confirm the result is identical under a UTF-8 locale too -- i.e.
	   that behavior really is locale-independent, not just "happens not
	   to crash under C". Skipped gracefully if the locale isn't
	   installed on the machine running the test. */
	if(setlocale(LC_ALL, "C.utf8") != NULL) {
		out = json_escape_string(long_ascii_then_invalid, &string_escapes);
		ok(out != NULL && out_c_locale != NULL && strcmp(out, out_c_locale) == 0,
			"result is identical under \"C\" and \"C.utf8\" locales");
		free(out);
		setlocale(LC_ALL, "C");
		}
	else {
		skip(1, "\"C.utf8\" locale not installed on this system");
		}
	free(out_c_locale);

	/* Buffer growth path: escaping several characters that each expand
	   (e.g. every byte needing \u00XX) must not corrupt the string */
	out = json_escape_string("\x01\x02\x03\x04\x05\x06", &string_escapes);
	ok(out != NULL &&
		strcmp(out, "\\u0001\\u0002\\u0003\\u0004\\u0005\\u0006") == 0,
		"multiple consecutive escapes grow the buffer correctly");
	free(out);

	/* A long run of characters needing escaping exercises more than one
	   realloc cycle */
	{
		char many[64];
		char expect[64 * 6 + 1];
		char *p = expect;
		for(i = 0; i < sizeof(many); i++) {
			many[i] = '\x01';
			}
		many[sizeof(many) - 1] = '\0';
		for(i = 0; i < sizeof(many) - 1; i++) {
			memcpy(p, "\\u0001", 6);
			p += 6;
			}
		*p = '\0';
		out = json_escape_string(many, &string_escapes);
		ok(out != NULL && strcmp(out, expect) == 0,
			"long run of escaped characters survives multiple reallocs");
		free(out);
	}

	/* Escaping is non-destructive: repeated calls on the same input
	   produce the same output */
	{
		char *o1 = json_escape_string("a\\b", &string_escapes);
		char *o2 = json_escape_string("a\\b", &string_escapes);
		ok(o1 != NULL && o2 != NULL && strcmp(o1, o2) == 0,
			"escaping the same input twice gives the same result");
		free(o1);
		free(o2);
	}

	return exit_status();
	}
