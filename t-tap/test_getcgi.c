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

/*
 * cgi/getcgi.c's hex_to_char()/unescape_cgi_input() run on every CGI query
 * string and POST body this codebase parses (getcgivars() calls
 * unescape_cgi_input() on every decoded name/value pair), so a parsing bug
 * here has broad blast radius. These are also pure, dependency-free
 * functions (only libc, no Nagios object model), so they're linked here as
 * the REAL cgi/getcgi.o, not reimplemented or stubbed.
 */

#include <string.h>
#include <stdlib.h>

#include "../include/getcgi.h"
#include "tap.h"

extern unsigned char hex_to_char(char *input);
extern void unescape_cgi_input(char *input);

int
main() {
	char buf[64];

	plan_tests(18);

	/* hex_to_char(): NULL/empty input */
	ok(hex_to_char(NULL) == '\x0', "hex_to_char(NULL) returns NUL");
	ok(hex_to_char("") == '\x0', "hex_to_char(\"\") returns NUL");

	/* hex_to_char(): well-formed hex pairs */
	ok(hex_to_char("41") == 'A', "hex_to_char(\"41\") decodes to 'A'");
	ok(hex_to_char("2f") == '/', "hex_to_char(\"2f\") decodes to '/' (lowercase hex digits)");
	ok(hex_to_char("2F") == '/', "hex_to_char(\"2F\") decodes to '/' (uppercase hex digits)");
	ok(hex_to_char("00") == '\x0', "hex_to_char(\"00\") decodes to NUL byte");
	ok(hex_to_char("ff") == (unsigned char)0xff, "hex_to_char(\"ff\") decodes to 0xff");

	/*
	 * Regression test: hex_to_char() used to leave its local `outint`
	 * uninitialized when sscanf(..., "%X", &outint) found no valid hex
	 * digit at all (e.g. non-hex characters like "ZZ"), since sscanf()
	 * does not touch the target on a failed conversion. That meant the
	 * function could return an unpredictable byte built from stack
	 * garbage instead of a deterministic value. Fixed by initializing
	 * outint = 0. This asserts the now-deterministic behavior.
	 */
	ok(hex_to_char("ZZ") == '\x0', "hex_to_char(\"ZZ\") (no valid hex digit at all) deterministically returns NUL, not stack garbage");
	ok(hex_to_char("Z1") == '\x0', "hex_to_char(\"Z1\") (invalid leading digit) deterministically returns NUL, not stack garbage");
	ok(hex_to_char("1Z") == '\x1', "hex_to_char(\"1Z\") parses the leading valid digit only, per sscanf %%X's partial-match semantics");

	/* unescape_cgi_input(): plain text passes through unchanged */
	strcpy(buf, "hello world");
	unescape_cgi_input(buf);
	ok(strcmp(buf, "hello world") == 0, "unescape_cgi_input leaves plain text unchanged");

	/* unescape_cgi_input(): %XX sequences decoded */
	strcpy(buf, "a%20b%2Fc");
	unescape_cgi_input(buf);
	ok(strcmp(buf, "a b/c") == 0, "unescape_cgi_input decodes %%20 and %%2F");

	/* unescape_cgi_input(): '+' is NOT decoded to space (this function
	   only handles %XX; form-urlencoded '+' handling, if any, happens
	   elsewhere) -- pin down current behavior so a future change here is
	   deliberate, not accidental */
	strcpy(buf, "a+b");
	unescape_cgi_input(buf);
	ok(strcmp(buf, "a+b") == 0, "unescape_cgi_input does not translate '+' to space");

	/* unescape_cgi_input(): a truncated %-escape at the very end of the
	   string (nothing follows the '%') must not read past the
	   terminating NUL or corrupt the output -- this exercises
	   hex_to_char()'s own NULL/empty-input guard via the one-past-the-%
	   pointer unescape_cgi_input passes it */
	strcpy(buf, "abc%");
	unescape_cgi_input(buf);
	ok(strcmp(buf, "abc") == 0, "unescape_cgi_input handles a trailing bare '%%' without reading out of bounds");

	/* unescape_cgi_input(): only ONE hex digit follows the trailing '%'.
	   No out-of-bounds read happens (same guard as above), but per
	   sscanf %%X's partial-match semantics (see the "1Z" case above)
	   the single digit is still decoded on its own -- "abc%4" becomes
	   "abc" followed by the raw byte 0x04, not a clean truncation to
	   "abc". This pins down that (slightly surprising) real behavior. */
	strcpy(buf, "abc%4");
	unescape_cgi_input(buf);
	ok(strlen(buf) == 4 && memcmp(buf, "abc\x04", 4) == 0,
		"unescape_cgi_input decodes a lone trailing hex digit after '%%' as its partial value, without reading out of bounds");

	/* unescape_cgi_input(): NULL input is a documented no-op, not a crash */
	unescape_cgi_input(NULL);
	ok(1, "unescape_cgi_input(NULL) does not crash");

	/* unescape_cgi_input(): empty string stays empty */
	buf[0] = '\0';
	unescape_cgi_input(buf);
	ok(strcmp(buf, "") == 0, "unescape_cgi_input(\"\") stays empty");

	/* unescape_cgi_input(): decoding can only shrink or hold the string
	   length steady (each %XX -> 1 byte), never grow it -- guards
	   against any future edit accidentally writing past the original
	   buffer */
	{
		char big[8];
		size_t before;
		strncpy(big, "%41%41", sizeof(big) - 1);
		big[sizeof(big) - 1] = '\0';
		before = strlen(big);
		unescape_cgi_input(big);
		ok(strlen(big) <= before, "unescape_cgi_input never grows the string in place");
	}

	return exit_status();
	}
